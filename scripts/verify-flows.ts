import assert from 'node:assert/strict';
import { handleApi } from '../server/api';
import { initialPosts } from '../src/data';

const originalFetch = globalThis.fetch;
type Entry = { sys: { id: string; version: number; updatedAt?: string }; fields: Record<string, unknown> };
const published: Entry[] = initialPosts.map((post, i) => ({ sys: { id: `seed-${i}`, version: 2, updatedAt: post.publishedAt }, fields: { ...post, tags: post.tags } }));
const drafts = new Map<string, Entry>();

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
 const url = new URL(String(input)), headers = new Headers(init?.headers), method = init?.method || 'GET';
 if (url.hostname === 'cdn.contentful.com') {
  assert.equal(headers.get('Authorization'), 'Bearer delivery-test-token');
  const id = url.searchParams.get('fields.id');
  const items = published.filter(post => !id || post.fields.id === id);
  return Response.json({ items: url.searchParams.get('limit') === '1' ? items.slice(0, 1) : items });
 }
 if (url.hostname === 'api.contentful.com' && url.pathname.endsWith('/entries') && method === 'POST') {
  assert.equal(headers.get('Authorization'), 'Bearer management-test-token');
  assert.equal(headers.get('X-Contentful-Content-Type'), 'blogPost');
  const fields = (JSON.parse(String(init?.body)) as { fields: Record<string, { 'en-US': unknown }> }).fields;
  const entry: Entry = { sys: { id: 'created-entry', version: 1 }, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value['en-US']])) };
  drafts.set(entry.sys.id, entry);
  return Response.json(entry, { status: 201 });
 }
 if (url.hostname === 'api.contentful.com' && url.pathname.endsWith('/entries/created-entry/published') && method === 'PUT') {
  assert.equal(headers.get('Authorization'), 'Bearer management-test-token');
  assert.equal(headers.get('X-Contentful-Version'), '1');
  const entry = drafts.get('created-entry'); assert.ok(entry);
  const result = { ...entry, sys: { ...entry.sys, version: 2, updatedAt: '2026-10-01T00:00:00.000Z' } };
  published.push(result); drafts.delete('created-entry');
  return Response.json(result);
 }
 throw new Error(`Unexpected endpoint: ${method} ${url}`);
}) as typeof fetch;

const env = {
 CONTENTFUL_SPACE_ID: 'test-space', CONTENTFUL_ENVIRONMENT: 'master', CONTENTFUL_LOCALE: 'en-US',
 CONTENTFUL_DELIVERY_TOKEN: 'delivery-test-token', CONTENTFUL_MANAGEMENT_TOKEN: 'management-test-token',
 EDITOR_EMAIL: 'editor@example.test', EDITOR_NAME: 'Test Editor', EDITOR_PASSWORD: 'test-only-password',
 SESSION_SECRET: 'test-only-session-secret-at-least-32-characters',
};
const request = (path: string, method = 'GET', body?: unknown, cookie?: string, origin = 'https://portfolio.example') => new Request('https://portfolio.example/api' + path, {
 method,
 headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
 ...(body ? { body: JSON.stringify(body) } : {}),
});

try {
 assert.equal((await handleApi(request('/posts', 'POST', { title: 'Unapproved post' }), env)).status, 401);
 assert.equal((await handleApi(request('/auth/login', 'POST', { email: 'editor@example.test', password: 'wrong' }), env)).status, 401);
 const login = await handleApi(request('/auth/login', 'POST', { email: 'EDITOR@example.test', password: 'test-only-password' }), env); assert.equal(login.status, 200);
 const cookie = login.headers.get('set-cookie')!; assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/);
 const session = await handleApi(request('/auth/session', 'GET', undefined, cookie), env); assert.equal((await session.json()).user.name, 'Test Editor');
 assert.equal((await handleApi(request('/posts', 'POST', { title: 'Valid article', content: 'A sufficiently long article that contains a useful observation for a field operations team.', category: 'Technology', tags: ['thermal'] }, cookie, 'https://hostile.example'), env)).status, 403);
 assert.equal((await handleApi(request('/posts', 'POST', { title: 'bad', content: 'too short', category: 'invalid' }, cookie), env)).status, 400);
 const publishedResponse = await handleApi(request('/posts', 'POST', { title: 'A useful field observation', content: 'A sufficiently long article that contains a useful observation for a field operations team.', category: 'Technology', tags: ['thermal', 'thermal'] }, cookie), env);
 assert.equal(publishedResponse.status, 201); const created = (await publishedResponse.json()).post;
 const publicRead = await handleApi(request('/posts/' + created.id), env); assert.equal((await publicRead.json()).post.title, 'A useful field observation');
 const publicList = await handleApi(request('/posts'), env); assert.equal((await publicList.json()).posts.length, 4);
 const tampered = cookie.replace('wildfire_editor=', 'wildfire_editor=x'); assert.equal((await (await handleApi(request('/auth/session', 'GET', undefined, tampered), env)).json()).user, null);
 const logout = await handleApi(request('/auth/logout', 'POST', {}, cookie), env);
 assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0/);
 assert.equal((await handleApi(request('/posts', 'POST', { title: 'Another valid title', content: 'A sufficiently long article that contains a useful observation for a field operations team.', category: 'Technology' }), env)).status, 401);
 console.log('Passed 12 API contract/security checks: editor login, session tamper rejection, origin protection, validation, Contentful draft creation/publication, public retrieval, and logout.');
 console.log('These checks mock Contentful. Live integration still requires the user’s Contentful space and credentials.');
} finally { globalThis.fetch = originalFetch; }
