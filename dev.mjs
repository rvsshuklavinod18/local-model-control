import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const jobs = [
  [process.execPath, [resolve(root, 'server/index.mjs')]],
  [process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1']],
]
const children = jobs.map(([command, args]) => spawn(command, args, {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
}))

let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill()
  process.exitCode = code
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message)
    shutdown(1)
  })
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) shutdown(code ?? 1)
  })
}

process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())