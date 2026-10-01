import { categories, type Post } from '../src/data';
export interface Environment { BACKENDLESS_BASE_URL?: string; BACKENDLESS_APP_ID?: string; BACKENDLESS_REST_API_KEY?: string; SESSION_SECRET?: string }
interface Session { token: string; email: string; name: string; expires: number }
const cookieName = 'wildfire_editor';
const encoder = new TextEncoder();
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unbase64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
function base(env: Environment) {
 if (env.BACKENDLESS_BASE_URL) { const url = new URL(env.BACKENDLESS_BASE_URL); if (url.protocol !== 'https:' || !url.hostname.endsWith('.backendless.app') || url.search || url.hash) throw new Error('The Backendless app URL must use its HTTPS backendless.app domain.'); return url.origin + '/api'; }
 if (env.BACKENDLESS_APP_ID && env.BACKENDLESS_REST_API_KEY) return 'https://api.backendless.com/' + encodeURIComponent(env.BACKENDLESS_APP_ID) + '/' + encodeURIComponent(env.BACKENDLESS_REST_API_KEY);
 throw new Error('Publishing is awaiting the Backendless app connection.');
}
async function backend<T>(env: Environment, path: string, init: RequestInit = {}, token?: string): Promise<T> {
 const response = await fetch(base(env) + path, { ...init, signal: AbortSignal.timeout(12000), headers: { 'Content-Type': 'application/json', ...(token ? { 'user-token': token } : {}), ...init.headers } });
 const result = await response.json() as T & { message?: string };
 if (!response.ok) throw new Error(result.message || 'Backendless could not complete this request.');
 return result;
}
async function signingKey(env: Environment) { if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('Editor sign-in is awaiting its server session configuration.'); return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
async function seal(session: Session, env: Environment) { const payload = base64(encoder.encode(JSON.stringify(session))); const signature = await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(payload)); return payload + '.' + base64(new Uint8Array(signature)); }
async function readSession(request: Request, env: Environment): Promise<Session | null> {
 const value = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
 if (!value || value.length > 4096) return null;
 try { const [payload, signature] = value.split('.'); if (!payload || !signature) return null; const signatureBytes = unbase64(signature); const signatureBuffer = new ArrayBuffer(signatureBytes.byteLength); new Uint8Array(signatureBuffer).set(signatureBytes); if (!await crypto.subtle.verify('HMAC', await signingKey(env), signatureBuffer, encoder.encode(payload))) return null; const session = JSON.parse(new TextDecoder().decode(unbase64(payload))) as Session; if (typeof session.token !== 'string' || session.expires < Date.now()) return null; const valid = await backend<boolean>(env, '/users/isvalidusertoken/' + encodeURIComponent(session.token)); return valid ? session : null; } catch { return null; }
}
function cookie(value: string, request: Request, expire = false) { return `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${expire ? 0 : 28800}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`; }
async function body(request: Request) { const raw = await request.text(); if (raw.length > 30000) throw new Error('The article is too long. Please shorten it and try again.'); return JSON.parse(raw) as Record<string, unknown>; }
function convert(row: Record<string, unknown>): Post {
 let tags: string[] = []; try { const parsed = JSON.parse(String(row.tags || '[]')); if (Array.isArray(parsed)) tags = parsed.filter(x => typeof x === 'string'); } catch {}
 const publishedAt = typeof row.publishedAt === 'number' ? new Date(row.publishedAt).toISOString() : String(row.publishedAt || new Date(Number(row.created) || Date.now()).toISOString());
 return { id: String(row.id || row.objectId), title: String(row.title || ''), excerpt: String(row.excerpt || ''), content: String(row.content || ''), category: String(row.category || categories[0]), tags, author: String(row.author || 'Editorial team'), publishedAt, image: '/images/wildfire-900.webp' };
}
export async function handleApi(request: Request, env: Environment): Promise<Response> {
 const url = new URL(request.url), path = url.pathname.replace(/^\/api/, '');
 try {
  if (request.method === 'POST') { const origin = request.headers.get('origin'); if (origin && origin !== url.origin) return json({ error: 'This publishing request must come from this website.' }, 403); const type = request.headers.get('content-type'); if (!type?.includes('application/json')) return json({ error: 'A JSON request is required.' }, 415); }
  if (path === '/health' && request.method === 'GET') return json({ status: 'ok', backendConfigured: Boolean(env.BACKENDLESS_BASE_URL || (env.BACKENDLESS_APP_ID && env.BACKENDLESS_REST_API_KEY)), authConfigured: Boolean(env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) });
  if (path === '/auth/session' && request.method === 'GET') { const session = await readSession(request, env); return json({ user: session ? { email: session.email, name: session.name } : null }); }
  if (path === '/auth/login' && request.method === 'POST') {
   await signingKey(env); const input = await body(request); if (typeof input.email !== 'string' || typeof input.password !== 'string' || input.email.length > 254 || input.password.length > 128) return json({ error: 'Enter your email and password.' }, 400);
   const user = await backend<Record<string, unknown>>(env, '/users/login', { method: 'POST', body: JSON.stringify({ login: input.email, password: input.password, stayLoggedIn: true }) });
   const token = user['user-token']; if (typeof token !== 'string') throw new Error('Backendless did not return an editor session.');
   const session: Session = { token, email: String(user.email || input.email), name: String(user.name || 'Editor'), expires: Date.now() + 28800000 };
   return json({ user: { name: session.name, email: session.email } }, 200, { 'Set-Cookie': cookie(await seal(session, env), request) });
  }
  if (path === '/auth/logout' && request.method === 'POST') { const session = await readSession(request, env); if (session) await backend(env, '/users/logout', { method: 'GET' }, session.token).catch(() => {}); return json({ success: true }, 200, { 'Set-Cookie': cookie('', request, true) }); }
  if (path === '/posts' && request.method === 'GET') { const rows = await backend<Record<string, unknown>[]>(env, '/data/BlogPosts?pageSize=100&sortBy=publishedAt%20DESC'); return json({ posts: rows.map(convert) }); }
  if (path.startsWith('/posts/') && request.method === 'GET') { const id = path.slice(7); if (!/^[a-z0-9-]{1,160}$/.test(id)) return json({ error: 'Article not found.' }, 404); const rows = await backend<Record<string, unknown>[]>(env, '/data/BlogPosts?pageSize=1&where=' + encodeURIComponent(`id='${id}'`)); return rows.length ? json({ post: convert(rows[0]) }) : json({ error: 'Article not found.' }, 404); }
  if (path === '/posts' && request.method === 'POST') {
   const session = await readSession(request, env); if (!session) return json({ error: 'Sign in before publishing an article.' }, 401);
   const input = await body(request); const title = typeof input.title === 'string' ? input.title.trim() : '', content = typeof input.content === 'string' ? input.content.trim() : '', category = String(input.category || '');
   if (title.length < 5 || title.length > 120 || content.length < 40 || content.length > 20000 || !categories.includes(category)) return json({ error: 'Use a title of 5–120 characters, content of 40–20,000 characters, and a listed category.' }, 400);
   const tags = Array.isArray(input.tags) ? [...new Set(input.tags.filter(t => typeof t === 'string').map(t => t.trim().slice(0, 32)).filter(Boolean))].slice(0, 8) : [];
   const id = (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'article') + '-' + crypto.randomUUID().slice(0, 8);
   const row = await backend<Record<string, unknown>>(env, '/data/BlogPosts', { method: 'POST', body: JSON.stringify({ id, title, content, category, tags: JSON.stringify(tags), author: session.name, publishedAt: new Date().toISOString(), excerpt: content.replace(/[#*`>\n]/g, ' ').replace(/\s+/g, ' ').slice(0, 180) }) }, session.token);
   return json({ post: convert(row) }, 201);
  }
  return json({ error: 'Endpoint not found.' }, 404);
 } catch (error) {
  const message = error instanceof Error ? error.message : 'The service is temporarily unavailable.';
  if (path === '/auth/login' && !message.includes('awaiting') && !message.includes('URL')) return json({ error: 'Sign-in failed. Check your editor credentials and try again.' }, 401);
  return json({ error: message.includes('awaiting') || message.includes('article') || message.includes('profile') ? message : 'The content service is temporarily unavailable. Please try again.' }, message.includes('awaiting') ? 503 : 502);
 }
}
export const isEditor = async (request: Request, env: Environment) => Boolean(await readSession(request, env));
