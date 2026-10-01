import { categories, type Post } from '../src/data';

export interface Environment {
 CONTENTFUL_SPACE_ID?: string;
 CONTENTFUL_ENVIRONMENT?: string;
 CONTENTFUL_LOCALE?: string;
 CONTENTFUL_DELIVERY_TOKEN?: string;
 CONTENTFUL_MANAGEMENT_TOKEN?: string;
 EDITOR_EMAIL?: string;
 EDITOR_NAME?: string;
 EDITOR_PASSWORD?: string;
 SESSION_SECRET?: string;
}

interface Session { email: string; name: string; expires: number }
interface ContentfulEntry { sys: { id: string; version?: number; updatedAt?: string }; fields: Record<string, unknown> }
interface ContentfulResponse { items: ContentfulEntry[]; sys?: { id?: string; version?: number; updatedAt?: string }; fields?: Record<string, unknown> }

const cookieName = 'wildfire_editor';
const encoder = new TextEncoder();
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unbase64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function signingKey(env: Environment) {
 if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('Editor sign-in is awaiting its server session configuration.');
 return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function seal(session: Session, env: Environment) {
 const payload = base64(encoder.encode(JSON.stringify(session)));
 const signature = await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(payload));
 return payload + '.' + base64(new Uint8Array(signature));
}

async function readSession(request: Request, env: Environment): Promise<Session | null> {
 const value = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
 if (!value || value.length > 4096) return null;
 try {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const signatureBytes = unbase64(signature), signatureBuffer = new ArrayBuffer(signatureBytes.byteLength);
  new Uint8Array(signatureBuffer).set(signatureBytes);
  if (!await crypto.subtle.verify('HMAC', await signingKey(env), signatureBuffer, encoder.encode(payload))) return null;
  const session = JSON.parse(new TextDecoder().decode(unbase64(payload))) as Session;
  return typeof session.email === 'string' && session.expires > Date.now() ? session : null;
 } catch { return null; }
}

function cookie(value: string, request: Request, expire = false) {
 return `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${expire ? 0 : 28800}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}

async function body(request: Request) {
 const raw = await request.text();
 if (raw.length > 30000) throw new Error('The article is too long. Please shorten it and try again.');
 return JSON.parse(raw) as Record<string, unknown>;
}

function context(env: Environment, write = false) {
 if (!env.CONTENTFUL_SPACE_ID || !env.CONTENTFUL_DELIVERY_TOKEN) throw new Error('Contentful is not configured yet.');
 if (write && !env.CONTENTFUL_MANAGEMENT_TOKEN) throw new Error('Contentful publishing is not configured yet.');
 const space = encodeURIComponent(env.CONTENTFUL_SPACE_ID);
 const environment = encodeURIComponent(env.CONTENTFUL_ENVIRONMENT || 'master');
 return {
  url: `${write ? 'https://api.contentful.com' : 'https://cdn.contentful.com'}/spaces/${space}/environments/${environment}`,
  token: write ? env.CONTENTFUL_MANAGEMENT_TOKEN! : env.CONTENTFUL_DELIVERY_TOKEN,
  locale: env.CONTENTFUL_LOCALE || 'en-US',
 };
}

async function contentful<T>(env: Environment, pathname: string, init: RequestInit = {}, write = false): Promise<T> {
 const cms = context(env, write), headers = new Headers(init.headers);
 headers.set('Authorization', `Bearer ${cms.token}`);
 if (write) headers.set('Content-Type', 'application/vnd.contentful.management.v1+json');
 const response = await fetch(cms.url + pathname, { ...init, headers, signal: AbortSignal.timeout(12000) });
 const raw = await response.text();
 let result: (T & { message?: string }) | undefined;
 try { result = raw ? JSON.parse(raw) as T & { message?: string } : undefined; } catch { result = undefined; }
 if (!response.ok) throw new Error(result?.message || `Contentful request failed (${response.status}).`);
 if (result === undefined) throw new Error('Contentful returned an empty response.');
 return result;
}

function convert(entry: ContentfulEntry): Post {
 const fields = entry.fields || {};
 const tags = Array.isArray(fields.tags) ? fields.tags.filter((tag): tag is string => typeof tag === 'string') : [];
 const category = String(fields.category || categories[0]);
 return {
  id: String(fields.id || entry.sys.id),
  title: String(fields.title || ''),
  excerpt: String(fields.excerpt || ''),
  content: String(fields.content || ''),
  category: categories.includes(category) ? category : categories[0],
  tags,
  author: String(fields.author || 'Editorial team'),
  publishedAt: String(fields.publishedAt || entry.sys.updatedAt || new Date().toISOString()),
  image: '/images/wildfire-900.webp',
 };
}

async function sameSecret(a: string, b: string) {
 const [left, right] = await Promise.all([
  crypto.subtle.digest('SHA-256', encoder.encode(a)),
  crypto.subtle.digest('SHA-256', encoder.encode(b)),
 ]);
 const x = new Uint8Array(left), y = new Uint8Array(right);
 let diff = 0;
 for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
 return diff === 0 && a.length === b.length;
}

function configured(env: Environment) {
 return Boolean(env.CONTENTFUL_SPACE_ID && env.CONTENTFUL_DELIVERY_TOKEN && env.CONTENTFUL_MANAGEMENT_TOKEN);
}

export async function handleApi(request: Request, env: Environment): Promise<Response> {
 const url = new URL(request.url), path = url.pathname.replace(/^\/api/, '');
 try {
  if (request.method === 'POST') {
   const origin = request.headers.get('origin');
   if (origin && origin !== url.origin) return json({ error: 'This publishing request must come from this website.' }, 403);
   if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'A JSON request is required.' }, 415);
  }
  if (path === '/health' && request.method === 'GET') return json({ status: 'ok', backendConfigured: configured(env), authConfigured: Boolean(env.EDITOR_EMAIL && env.EDITOR_PASSWORD && env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) });
  if (path === '/auth/session' && request.method === 'GET') {
   const session = await readSession(request, env);
   return json({ user: session ? { email: session.email, name: session.name } : null });
  }
  if (path === '/auth/login' && request.method === 'POST') {
   await signingKey(env);
   if (!env.EDITOR_EMAIL || !env.EDITOR_PASSWORD) throw new Error('Editor credentials are not configured yet.');
   const input = await body(request);
   if (typeof input.email !== 'string' || typeof input.password !== 'string' || input.email.length > 254 || input.password.length > 128) return json({ error: 'Enter your email and password.' }, 400);
   const emailMatches = await sameSecret(input.email.trim().toLowerCase(), env.EDITOR_EMAIL.trim().toLowerCase());
   const passwordMatches = await sameSecret(input.password, env.EDITOR_PASSWORD);
   if (!emailMatches || !passwordMatches) return json({ error: 'Sign-in failed. Check your editor credentials and try again.' }, 401);
   const session: Session = { email: env.EDITOR_EMAIL.trim(), name: env.EDITOR_NAME?.trim() || 'Editor', expires: Date.now() + 28800000 };
   return json({ user: { name: session.name, email: session.email } }, 200, { 'Set-Cookie': cookie(await seal(session, env), request) });
  }
  if (path === '/auth/logout' && request.method === 'POST') return json({ success: true }, 200, { 'Set-Cookie': cookie('', request, true) });
  if (path === '/posts' && request.method === 'GET') {
   const query = new URLSearchParams({ content_type: 'blogPost', limit: '100', order: '-fields.publishedAt' });
   const result = await contentful<ContentfulResponse>(env, `/entries?${query}`);
   return json({ posts: result.items.map(convert) });
  }
  if (path.startsWith('/posts/') && request.method === 'GET') {
   const id = path.slice(7);
   if (!/^[a-z0-9-]{1,160}$/.test(id)) return json({ error: 'Article not found.' }, 404);
   const query = new URLSearchParams({ content_type: 'blogPost', limit: '1', 'fields.id': id });
   const result = await contentful<ContentfulResponse>(env, `/entries?${query}`);
   return result.items.length ? json({ post: convert(result.items[0]) }) : json({ error: 'Article not found.' }, 404);
  }
  if (path === '/posts' && request.method === 'POST') {
   const session = await readSession(request, env);
   if (!session) return json({ error: 'Sign in before publishing an article.' }, 401);
   context(env, true);
   const input = await body(request), title = typeof input.title === 'string' ? input.title.trim() : '', content = typeof input.content === 'string' ? input.content.trim() : '', category = String(input.category || '');
   if (title.length < 5 || title.length > 120 || content.length < 40 || content.length > 20000 || !categories.includes(category)) return json({ error: 'Use a title of 5–120 characters, content of 40–20,000 characters, and a listed category.' }, 400);
   const tags = Array.isArray(input.tags) ? [...new Set(input.tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim().slice(0, 32)).filter(Boolean))].slice(0, 8) : [];
   const id = (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'article') + '-' + crypto.randomUUID().slice(0, 8);
   const cms = context(env, true), locale = cms.locale, publishedAt = new Date().toISOString();
   const localized = (value: unknown) => ({ [locale]: value });
   const created = await contentful<ContentfulEntry>(env, `/entries`, {
    method: 'POST',
    headers: { 'X-Contentful-Content-Type': 'blogPost' },
    body: JSON.stringify({ fields: {
     id: localized(id), title: localized(title), excerpt: localized(content.replace(/[#*`>\n]/g, ' ').replace(/\s+/g, ' ').slice(0, 180)), content: localized(content), category: localized(category), tags: localized(tags), author: localized(session.name), publishedAt: localized(publishedAt),
    } }),
   }, true);
   if (!created.sys?.id || !created.sys.version) throw new Error('Contentful created the article but returned no publish version.');
   const entryId = encodeURIComponent(created.sys.id);
   const published = await contentful<ContentfulEntry>(env, `/entries/${entryId}/published`, { method: 'PUT', headers: { 'X-Contentful-Version': String(created.sys.version) } }, true);
   return json({ post: convert(published) }, 201);
  }
  return json({ error: 'Endpoint not found.' }, 404);
 } catch (error) {
  const message = error instanceof Error ? error.message : 'The service is temporarily unavailable.';
  if (path === '/auth/login' && !message.toLowerCase().includes('configured') && !message.includes('awaiting')) return json({ error: 'Sign-in failed. Check your editor credentials and try again.' }, 401);
  const needsSetup = message.toLowerCase().includes('configured') || message.includes('awaiting');
  return json({ error: needsSetup ? message : 'The content service is temporarily unavailable. Please try again.' }, needsSetup ? 503 : 502);
 }
}

export const isEditor = async (request: Request, env: Environment) => Boolean(await readSession(request, env));
