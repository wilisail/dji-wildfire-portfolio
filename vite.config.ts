import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { handleApi, type Environment } from './server/api';
export default defineConfig(({ mode }) => ({
 plugins: [react(), tailwind(), { name: 'portfolio-api', configureServer(server) { const env = loadEnv(mode, process.cwd(), '') as Environment; server.middlewares.use(async (req, res, next) => {
 if (req.url?.startsWith('/__qa/mobile')) { const u = new URL(req.url, 'http://localhost'); const target = u.searchParams.get('route') || '/'; const safe = /^\/(about|solutions|teams|blog|login|create-blog)?$/.test(target) ? target : '/'; res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><html><head><title>Mobile viewport check</title><style>body{margin:0;background:#dce1e6;display:flex;justify-content:center;padding:24px}iframe{width:390px;height:844px;border:0;background:white}</style></head><body><iframe title="390-pixel mobile viewport" src="' + safe + '"></iframe></body></html>'); }
 if (!req.url?.startsWith('/api/')) return next(); try { let raw = ''; for await (const part of req) { raw += String(part); if (raw.length > 30000) break; } const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v); const request = new Request('http://' + (req.headers.host || 'localhost:4173') + req.url, { method: req.method, headers, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: raw } : {}) }); const result = await handleApi(request, env); res.statusCode = result.status; result.headers.forEach((v, k) => res.setHeader(k, v)); res.end(await result.text()); } catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'The development service is unavailable.' })); } }); } }],
 server: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: ['terminal.local'], hmr: { clientPort: 80, host: 'terminal.local', protocol: 'ws' } },
 build: { outDir: 'dist/client', sourcemap: false, target: 'es2022', cssCodeSplit: true },
}));
