import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { App } from '../src/App';
import { routeInfo, initialPosts } from '../src/data';
const out = path.resolve('dist/client');
const template = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const origin = process.env.SITE_ORIGIN || '';
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const pages = Object.entries(routeInfo).map(([route, data]) => ({ route, ...data })).concat(initialPosts.map(p => ({ route: '/blog/' + p.id, title: p.title + ' | DJI Enterprise Portfolio', description: p.excerpt })));
for (const page of pages) {
 const markup = renderToString(<App path={page.route} />);
 let html = template.replace('<div id="root"></div>', '<div id="root" data-route="' + escape(page.route) + '">' + markup + '</div>').replace(/<title>[^<]*<\/title>/, '<title>' + escape(page.title) + '</title>').replace(/<meta name="description" content="[^"]*"\s*\/>/, '<meta name="description" content="' + escape(page.description) + '" />');
 if (origin) html = html.replace('</head>', '<link rel="canonical" href="' + escape(origin + page.route) + '" /></head>');
 const folder = page.route === '/' ? out : path.join(out, page.route.slice(1)); fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'index.html'), html);
}
const missing = renderToString(<App path="/not-found" />); fs.writeFileSync(path.join(out, '404.html'), template.replace('<div id="root"></div>', '<div id="root">' + missing + '</div>').replace(/<title>[^<]*<\/title>/, '<title>Page Not Found | DJI Enterprise Portfolio</title>'));
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n' + (origin ? 'Sitemap: ' + origin + '/sitemap.xml\n' : ''));
if (origin) fs.writeFileSync(path.join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + pages.filter(p => !['/login', '/create-blog'].includes(p.route)).map(p => '<url><loc>' + escape(origin + p.route) + '</loc></url>').join('') + '</urlset>');
fs.writeFileSync('seed-posts.json', JSON.stringify(initialPosts.map(({ image, ...p }) => ({ ...p, tags: JSON.stringify(p.tags) })), null, 2));
console.log('Prerendered', pages.length, 'pages with titles, descriptions and accessible content.');
