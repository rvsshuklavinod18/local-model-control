import { createServer, request as httpRequest } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dataDirectory = resolve(process.env.DASHBOARD_DATA_DIR ?? resolve(root, 'data'))
const activityPath = resolve(dataDirectory, 'activity.jsonl')
const port = Number(process.env.DASHBOARD_PORT ?? 3210)
const host = process.env.DASHBOARD_HOST ?? '127.0.0.1'
const dockerMode = process.env.DASHBOARD_DOCKER === 'true'
const ollamaUrl = new URL(process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434')
const nvidiaSmiExe = process.env.NVIDIA_SMI_PATH ?? (process.platform === 'win32'
  ? resolve(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe')
  : 'nvidia-smi')
const wingetExe = process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'winget.exe')
  : 'winget'
const trackedInferencePaths = new Set([
  '/api/chat',
  '/api/generate',
  '/api/embeddings',
  '/v1/chat/completions',
  '/v1/completions',
  '/v1/embeddings',
])
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}
let activity = []

await mkdir(dataDirectory, { recursive: true })
try {
  const lines = (await readFile(activityPath, 'utf8')).trim().split('\n').filter(Boolean)
  activity = lines.slice(-300).map((line) => JSON.parse(line))
} catch {
  activity = []
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(value))
}

async function readRequestBody(request, limit = 32 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('Request body is too large.'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(request) {
  if (!String(request.headers['content-type'] ?? '').includes('application/json')) {
    throw Object.assign(new Error('Expected an application/json request.'), { status: 415 })
  }
  const body = await readRequestBody(request, 1024 * 1024)
  if (!body.length) return {}
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw Object.assign(new Error('Invalid JSON body.'), { status: 400 })
  }
}

function assertLocalRequest(request) {
  const address = request.socket.remoteAddress ?? ''
  const localAddress = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address
  const octets = ipv4.split('.').map(Number)
  const privateDockerPeer = dockerMode && octets.length === 4 && (
    octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
  )
  const origin = request.headers.origin
  let localOrigin = true
  if (origin) {
    try {
      localOrigin = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)
    } catch {
      localOrigin = false
    }
  }
  return (localAddress || privateDockerPeer) && localOrigin
}

async function recordActivity(event) {
  const entry = { id: randomUUID(), timestamp: new Date().toISOString(), ...event }
  activity.push(entry)
  activity = activity.slice(-300)
  await appendFile(activityPath, `${JSON.stringify(entry)}\n`, 'utf8')
  try {
    if ((await stat(activityPath)).size > 2 * 1024 * 1024) {
      await writeFile(activityPath, `${activity.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8')
    }
  } catch {
    // The in-memory activity list remains available if the log file is unavailable.
  }
  return entry
}

async function ollamaJson(pathname) {
  const response = await fetch(new URL(pathname, ollamaUrl), {
    signal: AbortSignal.timeout(2500),
  })
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`)
  return response.json()
}

async function getGpuStats() {
  try {
    const { stdout } = await execFileAsync(nvidiaSmiExe, [
      '--query-gpu=name,memory.total,memory.used,temperature.gpu,utilization.gpu,fan.speed,power.draw',
      '--format=csv,noheader,nounits',
    ], { timeout: 2500, windowsHide: true })
    const values = stdout.trim().split(/,\s*/)
    const numberOrNull = (value) => {
      const result = Number.parseFloat(value)
      return Number.isFinite(result) ? result : null
    }
    return {
      name: values[0] ?? 'NVIDIA GPU',
      vramTotalMiB: numberOrNull(values[1]),
      vramUsedMiB: numberOrNull(values[2]),
      temperatureC: numberOrNull(values[3]),
      utilizationPercent: numberOrNull(values[4]),
      fanPercent: numberOrNull(values[5]),
      powerWatts: numberOrNull(values[6]),
    }
  } catch {
    return null
  }
}

async function getEnvironmentSetting(name) {
  if (process.env[name]) return process.env[name]
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', 'HKCU\\Environment', '/v', name], {
      timeout: 1500,
      windowsHide: true,
    })
    return stdout.match(new RegExp(`${name}\\s+REG_[A-Z_]+\\s+(.+)`, 'i'))?.[1]?.trim() ?? null
  } catch {
    return null
  }
}

async function getStatus() {
  const [tagsResult, psResult, gpu] = await Promise.allSettled([
    ollamaJson('/api/tags'),
    ollamaJson('/api/ps'),
    getGpuStats(),
  ])
  const tags = tagsResult.status === 'fulfilled' ? tagsResult.value : null
  const running = psResult.status === 'fulfilled' ? psResult.value : null
  const gpuResult = gpu.status === 'fulfilled' ? gpu.value : null
  const error = tagsResult.status === 'rejected' ? tagsResult.reason?.message : null
  const [gpuOverheadBytes, keepAlive] = await Promise.all([
    getEnvironmentSetting('OLLAMA_GPU_OVERHEAD'),
    getEnvironmentSetting('OLLAMA_KEEP_ALIVE'),
  ])
  return {
    connected: Boolean(tags),
    ollamaUrl: ollamaUrl.origin,
    error,
    models: tags?.models ?? [],
    running: running?.models ?? [],
    gpu: gpuResult,
    settings: { gpuOverheadBytes, keepAlive },
    canUninstall: process.platform === 'win32' && !dockerMode,
    monitoredAt: new Date().toISOString(),
  }
}

function parseModel(body) {
  try {
    return JSON.parse(body.toString('utf8')).model ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

async function proxyOllama(request, response, incomingUrl) {
  let body
  try {
    body = await readRequestBody(request)
  } catch (error) {
    sendJson(response, error.status ?? 413, { error: error.message })
    return
  }
  const path = `${incomingUrl.pathname.slice('/ollama'.length) || '/'}${incomingUrl.search}`
  const endpoint = incomingUrl.pathname.slice('/ollama'.length) || '/'
  const model = request.method === 'POST' ? parseModel(body) : 'unknown'
  const isInference = request.method === 'POST' && trackedInferencePaths.has(endpoint)
  const startedAt = Date.now()
  const requestHeaders = { ...request.headers, host: ollamaUrl.host }
  delete requestHeaders.connection
  delete requestHeaders['accept-encoding']
  if (body.length) requestHeaders['content-length'] = String(body.length)
  else {
    delete requestHeaders['content-length']
    delete requestHeaders['transfer-encoding']
  }

  let logged = false
  const logRequest = (statusCode) => {
    if (!isInference || logged) return
    logged = true
    void recordActivity({
      category: 'inference',
      method: request.method,
      endpoint,
      model,
      statusCode,
      durationMs: Date.now() - startedAt,
    })
  }

  const upstream = httpRequest({
    hostname: ollamaUrl.hostname,
    port: ollamaUrl.port || 80,
    path,
    method: request.method,
    headers: requestHeaders,
    timeout: 0,
  })
  upstream.on('response', (upstreamResponse) => {
    const headers = { ...upstreamResponse.headers }
    delete headers.connection
    response.writeHead(upstreamResponse.statusCode ?? 502, headers)
    upstreamResponse.pipe(response)
    upstreamResponse.on('end', () => logRequest(upstreamResponse.statusCode ?? 502))
  })
  upstream.on('error', (error) => {
    logRequest(502)
    if (!response.headersSent) sendJson(response, 502, { error: `Ollama proxy error: ${error.message}` })
    else response.destroy(error)
  })
  upstream.end(body)
}

async function unloadModel(model) {
  const response = await fetch(new URL('/api/generate', ollamaUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: 0 }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Ollama could not stop ${model} (HTTP ${response.status}).`)
  await response.json()
}

async function stopRunningModels(models) {
  for (const model of models) await unloadModel(model.name)
  return models.length
}

async function deleteModel(model) {
  const response = await fetch(new URL('/api/delete', ollamaUrl), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Ollama could not remove the model (HTTP ${response.status}).`)
}

async function serveStatic(pathname, response) {
  const dist = resolve(root, 'dist')
  const relativePath = decodeURIComponent(pathname === '/' ? 'index.html' : pathname.slice(1))
  let target = resolve(dist, relativePath)
  if (target !== dist && !target.startsWith(`${dist}${sep}`)) {
    response.writeHead(403).end('Forbidden')
    return
  }
  try {
    const file = await readFile(target)
    response.writeHead(200, {
      'cache-control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      'content-type': contentTypes[extname(target)] ?? 'application/octet-stream',
    })
    response.end(file)
  } catch {
    if (extname(pathname)) {
      response.writeHead(404).end('Not found')
      return
    }
    target = resolve(dist, 'index.html')
    try {
      response.writeHead(200, { 'content-type': contentTypes['.html'] })
      response.end(await readFile(target))
    } catch {
      response.writeHead(404).end('Build the frontend with npm run build first.')
    }
  }
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/status') {
    sendJson(response, 200, await getStatus())
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/activity') {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 100)))
    sendJson(response, 200, { events: activity.slice(-limit).reverse() })
    return
  }
  if (request.method === 'DELETE' && url.pathname === '/api/activity') {
    activity = []
    await writeFile(activityPath, '', 'utf8')
    sendJson(response, 200, { ok: true })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/stop-all') {
    const status = await getStatus()
    const count = await stopRunningModels(status.running)
    await recordActivity({ category: 'control', action: 'stop-all', modelCount: count, statusCode: 200 })
    sendJson(response, 200, { ok: true, stopped: count })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/models/stop') {
    const { model } = await readJson(request)
    if (typeof model !== 'string' || model.length > 160) {
      sendJson(response, 400, { error: 'A valid model name is required.' })
      return
    }
    await unloadModel(model)
    await recordActivity({ category: 'control', action: 'model-stopped', model, statusCode: 200 })
    sendJson(response, 200, { ok: true })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/models/remove') {
    const { model, confirmation } = await readJson(request)
    if (typeof model !== 'string' || model.length > 160 || confirmation !== model) {
      sendJson(response, 400, { error: 'Model confirmation did not match.' })
      return
    }
    const running = await ollamaJson('/api/ps')
    if ((running.models ?? []).some((item) => item.name === model)) await unloadModel(model)
    await deleteModel(model)
    await recordActivity({ category: 'control', action: 'model-removed', model, statusCode: 200 })
    sendJson(response, 200, { ok: true })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/uninstall') {
    const { confirmation, removeModels = false } = await readJson(request)
    if (confirmation !== 'UNINSTALL OLLAMA') {
      sendJson(response, 400, { error: 'Uninstall confirmation did not match.' })
      return
    }
    if (process.platform !== 'win32' || dockerMode) {
      sendJson(response, 501, { error: 'Uninstall Ollama from the host. Removing the dashboard container does not uninstall the host runtime.' })
      return
    }
    const status = await getStatus()
    await stopRunningModels(status.running)
    if (removeModels) {
      for (const model of status.models) await deleteModel(model.name)
    }
    if (process.platform === 'win32') {
      try {
        await execFileAsync('taskkill.exe', ['/IM', 'ollama.exe', '/T', '/F'], {
          timeout: 10_000,
          windowsHide: true,
        })
      } catch {
        // The app may already be stopped.
      }
      const { stdout, stderr } = await execFileAsync(wingetExe, [
        'uninstall', '--id', 'Ollama.Ollama', '--exact', '--source', 'winget',
        '--silent', '--accept-source-agreements',
      ], { timeout: 120_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
      await recordActivity({ category: 'control', action: 'ollama-uninstalled', removeModels, statusCode: 200 })
      sendJson(response, 200, { ok: true, output: stdout || stderr })
      return
    }
  }
  sendJson(response, 404, { error: 'Not found' })
}

const server = createServer(async (request, response) => {
  if (!assertLocalRequest(request)) {
    sendJson(response, 403, { error: 'This dashboard is restricted to local requests.' })
    return
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  try {
    if (url.pathname === '/ollama' || url.pathname.startsWith('/ollama/')) {
      await proxyOllama(request, response, url)
      return
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url)
      return
    }
    await serveStatic(url.pathname, response)
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, error.status ?? 500, { error: error.message ?? 'Unexpected server error.' })
    } else {
      response.destroy(error)
    }
  }
})

server.listen(port, host, () => {
  console.log(`Local Model Control API listening at http://${host}:${port}`)
})