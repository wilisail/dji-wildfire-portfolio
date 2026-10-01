import assert from 'node:assert/strict';
import { handleApi } from '../server/api';
import { initialPosts } from '../src/data';
const originalFetch = globalThis.fetch;
const rows: Record<string, unknown>[] = initialPosts.map(p => ({ ...p, tags: JSON.stringify(p.tags) }));
let valid = false;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
 const url = String(input); const headers = new Headers(init?.headers);
 if (url.endsWith('/users/login')) { const body = JSON.parse(String(init?.body)); if (body.password !== 'test-only-password') return new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 }); valid = true; return Response.json({ email: body.login, name: 'Test Editor', 'user-token': 'test-token' }); }
 if (url.includes('/users/isvalidusertoken/')) return Response.json(valid && url.endsWith('/test-token'));
 if (url.endsWith('/users/logout')) { valid = false; return Response.json({ success: true }); }
 if (url.includes('/data/BlogPosts')) { if (init?.method === 'POST') { assert.equal(headers.get('user-token'), 'test-token'); assert.equal(valid, true); const row = { ...JSON.parse(String(init.body)), objectId: 'saved-test-object' }; rows.push(row); return Response.json(row); } const where = new URL(url).searchParams.get('where'); return Response.json(where ? rows.filter(p => `id='${p.id}'` === where) : rows); }
 throw new Error('Unexpected external endpoint in contract test: ' + url);
}) as typeof fetch;
const env = { BACKENDLESS_BASE_URL: 'https://test.backendless.app/api', SESSION_SECRET: 'test-only-session-secret-at-least-32-characters' };
const request = (path: string, method = 'GET', body?: unknown, cookie?: string, origin = 'https://portfolio.example') => new Request('https://portfolio.example/api' + path, { method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
try {
 assert.equal((await handleApi(request('/posts', 'POST', {title:'Unapproved post'}), env)).status, 401);
 assert.equal((await handleApi(request('/auth/login', 'POST', {email:'editor@example.test', password:'wrong'}), env)).status, 401);
 const login = await handleApi(request('/auth/login', 'POST', {email:'editor@example.test', password:'test-only-password'}), env); assert.equal(login.status, 200);
 const cookie = login.headers.get('set-cookie')!; assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/);
 const session = await handleApi(request('/auth/session', 'GET', undefined, cookie), env); assert.equal((await session.json()).user.name, 'Test Editor');
 assert.equal((await handleApi(request('/posts', 'POST', { title:'Valid article', content:'A sufficiently long article that contains a useful observation for a field operations team.', category:'Technology', tags:['thermal'] }, cookie, 'https://hostile.example'), env)).status, 403);
 assert.equal((await handleApi(request('/posts', 'POST', { title:'bad', content:'too short', category:'invalid' }, cookie), env)).status, 400);
 const published = await handleApi(request('/posts', 'POST', { title:'A useful field observation', content:'A sufficiently long article that contains a useful observation for a field operations team.', category:'Technology', tags:['thermal','thermal'] }, cookie), env); assert.equal(published.status, 201); const created = (await published.json()).post;
 const publicRead = await handleApi(request('/posts/' + created.id), env); assert.equal((await publicRead.json()).post.title, 'A useful field observation');
 const publicList = await handleApi(request('/posts'), env); assert.equal((await publicList.json()).posts.length, 4);
 const tampered = cookie.replace('wildfire_editor=', 'wildfire_editor=x'); assert.equal((await (await handleApi(request('/auth/session', 'GET', undefined, tampered), env)).json()).user, null);
 assert.equal((await handleApi(request('/auth/logout','POST',{},cookie), env)).status, 200);
 assert.equal((await handleApi(request('/posts','POST',{title:'Another valid title',content:'A sufficiently long article that contains a useful observation for a field operations team.',category:'Technology'},cookie),env)).status,401);
 console.log('Passed 12 API contract/security checks: sign-in, tamper rejection, origin protection, validation, publication, public retrieval, logout.');
 console.log('These checks mock Backendless. Live integration still requires the user’s Backendless app.');
} finally { globalThis.fetch = originalFetch; }
