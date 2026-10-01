import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApi, type Environment } from '../server/api.js';
type VercelRequest = IncomingMessage & { body?: unknown; query?: Record<string, string | string[] | undefined> };
export default async function handler(req: VercelRequest, res: ServerResponse) {
 const host = req.headers.host || 'localhost'; const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
 const original = new URL(req.url || '/', `${proto}://${host}`); const path = req.query?.path || original.searchParams.get('path'); const route = Array.isArray(path) ? path.join('/') : path;
 const url = new URL(route ? '/api/' + route : original.pathname, original.origin);
 url.search = original.search;
 url.searchParams.delete('path');
 let raw = ''; if (req.body !== undefined) raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body); else for await (const chunk of req) { raw += String(chunk); if (raw.length > 30000) break; }
 const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
 const request = new Request(url, { method: req.method, headers, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: raw } : {}) });
 const response = await handleApi(request, process.env as Environment); res.statusCode = response.status; response.headers.forEach((value, key) => res.setHeader(key, value)); res.end(await response.text());
}
