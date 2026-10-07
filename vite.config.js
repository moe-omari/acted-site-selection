import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = path.dirname(fileURLToPath(import.meta.url))
const areasFile = path.join(root, 'public', 'defined-areas.json')

const targetsFile = path.join(root, 'public', 'targets.json')

function saveJson(file, accept) {
  return (req, res, next) => {
    if (req.method !== 'POST') return next()
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!accept(raw)) throw new Error('unexpected payload')
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`)
        res.statusCode = 204
        res.end()
      } catch {
        res.statusCode = 400
        res.end()
      }
    })
  }
}

function saveAreasPlugin() {
  return {
    name: 'save-defined-areas',
    configureServer(server) {
      server.middlewares.use('/api/defined-areas', saveJson(areasFile, Array.isArray))
      server.middlewares.use('/api/targets', saveJson(targetsFile, (raw) => (
        raw && typeof raw === 'object' && !Array.isArray(raw) && raw.areas && typeof raw.areas === 'object'
      )))
    },
  }
}

export default defineConfig({
  plugins: [react(), saveAreasPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
})
