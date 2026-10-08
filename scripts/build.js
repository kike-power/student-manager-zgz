import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { parse } from 'acorn';
let html=await readFile('index.html','utf8');
const match=html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!match) throw new Error('No se encuentra el módulo de la aplicación.');
const ast=parse(match[1],{sourceType:'module',ecmaVersion:'latest'});
// Escape interpolated HTML attributes at their source, including JS string arguments
// inside the legacy inline handlers. Text/HTML blocks are additionally sanitized at runtime.
const edits=[];
function walk(node) {
  if(!node || typeof node!=='object')return;
  if(node.type==='TemplateLiteral') {
    let prefix='';
    for(let i=0;i<node.expressions.length;i++) {
      prefix+=node.quasis[i].value.cooked || node.quasis[i].value.raw;
      const tag=prefix.slice(prefix.lastIndexOf('<'));
      const attribute=tag.match(/([\w-]+)="([^"]*)$/);
      if(prefix.lastIndexOf('<')>prefix.lastIndexOf('>') && attribute) {
        const value=attribute[2];
        const singleQuotes=(value.match(/(?<!\\)'/g)||[]).length;
        const helper=attribute[1].startsWith('on') && singleQuotes%2 ? 'escHandlerArg' : attribute[1].startsWith('on') ? null : 'escAttr';
        if(helper) {const e=node.expressions[i];edits.push({pos:e.start,text:helper+'('},{pos:e.end,text:')'});}
      }
      prefix+='INTERPOLATED';
    }
  }
  for(const value of Object.values(node)) if(Array.isArray(value))value.forEach(walk);else if(value && typeof value==='object')walk(value);
}
walk(ast);
let script=match[1];
for(const e of edits.sort((a,b)=>b.pos-a.pos))script=script.slice(0,e.pos)+e.text+script.slice(e.pos);
script=`function escAttr(value){return String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll("'",'&#39;').replaceAll('<','&lt;').replaceAll('>','&gt;');}\nfunction escHandlerArg(value){return escAttr(String(value??'').replaceAll('\\\\','\\\\\\\\').replaceAll("'","\\\\'").replaceAll('\\n','\\\\n').replaceAll('\\r','\\\\r'));}\n`+script;
parse(script,{sourceType:'module',ecmaVersion:'latest'});
await rm('dist',{recursive:true,force:true});
await mkdir('dist/vendor',{recursive:true});
await cp('client','dist/client',{recursive:true});
const functionNames=[...new Set([...match[1].matchAll(/(?:function\s+|window\.)([A-Za-z_$][\w$]*)\s*(?:\(|=)/g)].map(m=>m[1]))];
await writeFile('dist/client/handlers.js',`export const ALLOWED_HANDLERS=${JSON.stringify(functionNames)};\n`);
await writeFile('dist/client/app.js',script.replaceAll("'./client/", "'./"));
html=html.replace(match[0],'<script src="/vendor/purify.min.js"></script>\n<script type="module" src="/client/app.js"></script>');
await writeFile('dist/index.html',html);
for(const file of ['manifest.json','sw.js','icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','favicon-16.png','favicon-32.png','favicon.ico']) await cp(file,'dist/'+file);
for(const [source,name] of [
  ['node_modules/dompurify/dist/purify.min.js','purify.min.js'],
  ['node_modules/acorn/dist/acorn.mjs','acorn.mjs'],
  ['node_modules/chart.js/dist/chart.umd.js','chart.umd.js'],
  ['node_modules/jspdf/dist/jspdf.umd.min.js','jspdf.umd.min.js'],
  ['node_modules/html2canvas/dist/html2canvas.min.js','html2canvas.min.js'],
  ['public/vendor/xlsx.full.min.js','xlsx.full.min.js']
]) await cp(source,'dist/vendor/'+name);
await cp('public/vendor/SHEETJS-LICENSE.txt','dist/vendor/SHEETJS-LICENSE.txt');
console.log('Artefacto público preparado en dist/ (solo archivos de la aplicación).');
