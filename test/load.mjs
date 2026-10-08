// Load src/lib/*.ts in Node via Vite's SSR module loader (no extra deps).
import { createServer } from 'vite'

let server
export async function loadLib(path) {
  server ??= await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  return server.ssrLoadModule(path)
}
export async function closeLib() {
  await server?.close()
  server = undefined
}
