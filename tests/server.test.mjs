import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const serverPath = resolve(projectRoot, 'server/index.mjs')

async function reservePort() {
  const probe = createServer()
  await new Promise((resolveListen, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolveListen)
  })
  const address = probe.address()
  await new Promise((resolveClose) => probe.close(resolveClose))
  return address.port
}

test('serves local status and keeps host uninstall unavailable in a container', async (context) => {
  const port = await reservePort()
  const dataDirectory = await mkdtemp(join(tmpdir(), 'modelkiln-test-'))
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      DASHBOARD_DATA_DIR: dataDirectory,
      DASHBOARD_DOCKER: 'true',
      DASHBOARD_HOST: '127.0.0.1',
      DASHBOARD_PORT: String(port),
      OLLAMA_BASE_URL: 'http://127.0.0.1:1',
    },
    stdio: 'ignore',
  })

  context.after(async () => {
    if (child.exitCode === null) {
      child.kill()
      await Promise.race([
        once(child, 'exit'),
        new Promise((resolveExit) => setTimeout(resolveExit, 1500)),
      ])
    }
    await rm(dataDirectory, { recursive: true, force: true })
  })

  const baseUrl = `http://127.0.0.1:${port}`
  let healthResponse
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Dashboard server exited before becoming ready.')
    try {
      healthResponse = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(250) })
      break
    } catch {
      await new Promise((resolveRetry) => setTimeout(resolveRetry, 100))
    }
  }

  assert.equal(healthResponse?.status, 200)
  assert.deepEqual(await healthResponse.json(), { ok: true })

  const statusResponse = await fetch(`${baseUrl}/api/status`)
  const status = await statusResponse.json()
  assert.equal(statusResponse.status, 200)
  assert.equal(typeof status.connected, 'boolean')
  assert.equal(status.canUninstall, false)
  assert.deepEqual(status.models, [])

  const foreignOrigin = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: 'https://example.invalid' },
  })
  assert.equal(foreignOrigin.status, 403)

  const uninstallAttempt = await fetch(`${baseUrl}/api/uninstall`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmation: 'UNINSTALL OLLAMA', removeModels: true }),
  })
  assert.equal(uninstallAttempt.status, 501)
})