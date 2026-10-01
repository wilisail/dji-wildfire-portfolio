import { categories, type Post } from '../src/data.js';

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
interface ContentfulResponse { items: ContentfulEntry[]; includes?: { Asset?: ContentfulEntry[]; Entry?: ContentfulEntry[] }; sys?: { id?: string; version?: number; updatedAt?: string }; fields?: Record<string, unknown> }
const contentType = 'pageBlogPost';

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
 type CmsError = { message?: string; details?: { errors?: Array<{ name?: string; path?: Array<string | number>; details?: string }> } };
 let result: (T & CmsError) | undefined;
 try { result = raw ? JSON.parse(raw) as T & CmsError : undefined; } catch { result = undefined; }
 if (!response.ok) {
  const fields = result?.details?.errors?.map(error => `${error.path?.join('.') || error.name || 'Article'}: ${error.details || error.name || 'invalid value'}`).join('; ');
  throw new Error((result?.message || `Contentful request failed (${response.status}).`) + (fields ? ` — ${fields}` : ''));
 }
 if (result === undefined) throw new Error('Contentful returned an empty response.');
 return result;
}

function richTextToMarkdown(value: unknown): string {
 if (!value || typeof value !== 'object') return typeof value === 'string' ? value : '';
 const visit = (node: unknown): string => {
  if (!node || typeof node !== 'object') return '';
  const item = node as { nodeType?: string; value?: string; marks?: Array<{ type?: string }>; content?: unknown[]; data?: { uri?: string } };
  if (item.nodeType === 'text') {
   let text = item.value || '';
   for (const mark of item.marks || []) text = mark.type === 'bold' ? `**${text}**` : mark.type === 'italic' ? `*${text}*` : mark.type === 'code' ? `\`${text}\`` : text;
   return text;
  }
  const children = (item.content || []).map(visit).join('');
  switch (item.nodeType) {
   case 'heading-1': return `# ${children}\n\n`;
   case 'heading-2': return `## ${children}\n\n`;
   case 'heading-3': return `### ${children}\n\n`;
   case 'heading-4': return `#### ${children}\n\n`;
   case 'heading-5': return `##### ${children}\n\n`;
   case 'heading-6': return `###### ${children}\n\n`;
   case 'paragraph': return `${children}\n\n`;
   case 'blockquote': return children.split('\n').filter(Boolean).map(line => `> ${line}`).join('\n') + '\n\n';
   case 'unordered-list': case 'ordered-list': return children + '\n';
   case 'list-item': return `- ${children.trim()}\n`;
   case 'hr': return '\n---\n\n';
   case 'hyperlink': return `[${children}](${item.data?.uri || '#'})`;
   default: return children;
  }
 };
 return visit(value).trim();
}

function linkedId(value: unknown): string | undefined {
 if (!value || typeof value !== 'object') return undefined;
 const sys = (value as { sys?: { id?: unknown } }).sys;
 return typeof sys?.id === 'string' ? sys.id : undefined;
}

function convert(entry: ContentfulEntry, assets: ContentfulEntry[] = []): Post {
 const fields = entry.fields || {};
 const author = fields.author && typeof fields.author === 'object' ? (fields.author as { fields?: Record<string, unknown> }).fields : undefined;
 const imageId = linkedId(fields.featuredImage);
 const imageAsset = assets.find(asset => asset.sys.id === imageId);
 const imageFields = imageAsset?.fields || {};
 const file = imageFields.file && typeof imageFields.file === 'object' ? (imageFields.file as Record<string, unknown>) : {};
 const imageUrl = typeof file.url === 'string' ? (file.url.startsWith('//') ? `https:${file.url}` : file.url) : '';
 return {
  id: String(fields.slug || entry.sys.id),
  title: String(fields.title || ''),
  excerpt: String(fields.shortDescription || ''),
  content: richTextToMarkdown(fields.content),
  category: categories[0],
  tags: [],
  author: String(author?.name || author?.fullName || author?.internalName || 'Editorial team'),
  publishedAt: String(fields.publishedDate || entry.sys.updatedAt || new Date().toISOString()),
  image: imageUrl || '/images/wildfire-900.webp',
 };
}

function markdownToRichText(markdown: string) {
 const blocks = markdown.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).map(block => {
  const heading = block.match(/^(#{1,6})\s+(.+)$/);
  const nodeType = heading ? `heading-${heading[1].length}` : block === '---' ? 'hr' : 'paragraph';
  const text = heading ? heading[2] : block;
  return nodeType === 'hr' ? { nodeType, data: {}, content: [] } : {
   nodeType, data: {}, content: [{ nodeType: 'text', value: text.replace(/\[(.*?)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)'), marks: [], data: {} }],
  };
 });
 return { nodeType: 'document', data: {}, content: blocks.length ? blocks : [{ nodeType: 'paragraph', data: {}, content: [{ nodeType: 'text', value: '', marks: [], data: {} }] }] };
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
 let authenticatedPublisher = false;
 try {
  if (request.method === 'POST') {
   const origin = request.headers.get('origin');
   if (origin && origin !== url.origin) return json({ error: 'This publishing request must come from this website.' }, 403);
   if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'A JSON request is required.' }, 415);
  }
  if (path === '/health' && request.method === 'GET') {
   const health: Record<string, unknown> = { status: 'ok', backendConfigured: configured(env), authConfigured: Boolean(env.EDITOR_EMAIL && env.EDITOR_PASSWORD && env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) };
   if (url.searchParams.get('check') === 'publishing') {
    // Validate the deployed credential with a read-only request. Return only
    // service status, never credentials, account details, or CMS content.
    try {
     const cms = context(env, true);
     const response = await fetch(cms.url + '/content_types/' + contentType, {
      headers: { Authorization: `Bearer ${cms.token}` }, signal: AbortSignal.timeout(12000),
     });
     health.publishingCheck = { reachable: true, credentialAccepted: response.ok, upstreamStatus: response.status };
     await response.body?.cancel();
    } catch {
     health.publishingCheck = { reachable: false, credentialAccepted: false };
    }
   }
   return json(health);
  }
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
   const query = new URLSearchParams({ content_type: contentType, limit: '100', order: '-fields.publishedDate', include: '1' });
   const result = await contentful<ContentfulResponse>(env, `/entries?${query}`);
   return json({ posts: result.items.map(entry => convert(entry, result.includes?.Asset || [])) });
  }
  if (path.startsWith('/posts/') && request.method === 'GET') {
   const id = path.slice(7);
   if (!/^[a-z0-9-]{1,160}$/.test(id)) return json({ error: 'Article not found.' }, 404);
   const query = new URLSearchParams({ content_type: contentType, limit: '1', 'fields.slug': id, include: '1' });
   const result = await contentful<ContentfulResponse>(env, `/entries?${query}`);
   return result.items.length ? json({ post: convert(result.items[0], result.includes?.Asset || []) }) : json({ error: 'Article not found.' }, 404);
  }
  if (path === '/posts' && request.method === 'POST') {
   const session = await readSession(request, env);
   if (!session) return json({ error: 'Sign in before publishing an article.' }, 401);
   authenticatedPublisher = true;
   context(env, true);
   const input = await body(request), title = typeof input.title === 'string' ? input.title.trim() : '', content = typeof input.content === 'string' ? input.content.trim() : '', category = String(input.category || '');
   if (title.length < 5 || title.length > 120 || content.length < 40 || content.length > 20000 || !categories.includes(category)) return json({ error: 'Use a title of 5–120 characters, content of 40–20,000 characters, and a listed category.' }, 400);
   const tags = Array.isArray(input.tags) ? [...new Set(input.tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim().slice(0, 32)).filter(Boolean))].slice(0, 8) : [];
   const id = (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'article') + '-' + crypto.randomUUID().slice(0, 8);
   const cms = context(env, true), locale = cms.locale, publishedAt = new Date().toISOString();
   const localized = (value: unknown) => ({ [locale]: value });
   const seedQuery = new URLSearchParams({ content_type: contentType, limit: '1', select: 'fields.featuredImage' });
   const seedEntries = await contentful<ContentfulResponse>(env, `/entries?${seedQuery}`);
   const imageId = linkedId(seedEntries.items[0]?.fields?.featuredImage);
   if (!imageId) throw new Error('Publish one sample blog post with a featured image in Contentful before publishing from the website.');
   const created = await contentful<ContentfulEntry>(env, `/entries`, {
    method: 'POST',
    headers: { 'X-Contentful-Content-Type': contentType },
    body: JSON.stringify({ fields: {
     internalName: localized(title + ' (' + id.slice(-8) + ')'), slug: localized(id), publishedDate: localized(publishedAt.slice(0, 10)), title: localized(title), shortDescription: localized(content.replace(/[#*`>\n]/g, ' ').replace(/\s+/g, ' ').slice(0, 180)), content: localized(markdownToRichText(content)), featuredImage: localized({ sys: { type: 'Link', linkType: 'Asset', id: imageId } }),
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
  if (authenticatedPublisher) return json({ error: message }, 502);
  if (path === '/auth/login' && !message.toLowerCase().includes('configured') && !message.includes('awaiting')) return json({ error: 'Sign-in failed. Check your editor credentials and try again.' }, 401);
  const needsSetup = message.toLowerCase().includes('configured') || message.includes('awaiting');
  return json({ error: needsSetup ? message : 'The content service is temporarily unavailable. Please try again.' }, needsSetup ? 503 : 502);
 }
}

export const isEditor = async (request: Request, env: Environment) => Boolean(await readSession(request, env));
