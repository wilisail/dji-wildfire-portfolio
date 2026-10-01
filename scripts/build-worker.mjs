import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'};
const files={};function walk(dir){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);if(fs.statSync(file).isDirectory())walk(file);else{const relative='/'+path.relative('dist/client',file).split(path.sep).join('/');files[relative]={type:types[path.extname(name)]||'application/octet-stream',body:fs.readFileSync(file).toString('base64')};}}}walk('dist/client');
fs.mkdirSync('.sites-runtime',{recursive:true});fs.writeFileSync('.sites-runtime/asset-map.ts','export default '+JSON.stringify(files));
await build({entryPoints:['server/worker.ts'],outfile:'dist/server/index.js',bundle:true,format:'esm',target:'es2022',platform:'neutral',minify:true});
console.log('Prepared portable Worker bundle and Vercel static output.');
