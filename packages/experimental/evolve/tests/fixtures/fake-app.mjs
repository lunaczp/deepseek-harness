// Fake application used by the supervisor specs. It stands in for `dsh`: it accepts connections,
// publishes the readiness handshake the evolve plugin would write, and refuses to start for the
// generation named by FAKE_FAIL_GENERATION.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createServer } from 'node:net'

const generation = process.env.DSH_EVOLVE_GENERATION ?? ''
const failGeneration = process.env.FAKE_FAIL_GENERATION ?? ''

if (generation !== '' && generation === failGeneration) {
  console.error(`fake-app: refusing to start ${generation}`)
  process.exit(1)
}

const port = Number(process.env.FAKE_PORT)
const ready = process.env.DSH_EVOLVE_READY ?? ''
const server = createServer(socket => socket.end())

server.listen(port, '127.0.0.1', () => {
  mkdirSync(dirname(ready), { recursive: true })
  writeFileSync(ready, `${new Date().toISOString()}\n`)
})

const stop = () => {
  server.close()
  process.exit(0)
}

process.on('SIGTERM', stop)
process.on('SIGINT', stop)
