import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const script=readFileSync('client/database.js','utf8').replaceAll('export ','')+'\nwindow.downloadForTest=downloadFile;';
test('download helper fetches the authorized path, creates a download link and cleans it up',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://school.example',runScripts:'outside-only'}),w=dom.window;
  let request,link;
  w.fetch=async(url,opts)=>{request={url,opts};return {ok:true,blob:async()=>new w.Blob(['data'],{type:'application/octet-stream'})};};
  w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){link={name:this.download,href:this.href,connected:this.isConnected};};
  w.eval(script);
  await w.downloadForTest('orphans/tareas/a1/t1/archivoAlumno','assignment.html',{quarantine:true});
  assert.match(request.url,/quarantine=1/);assert.equal(request.opts.credentials,'same-origin');assert.equal(request.opts.cache,'no-store');
  assert.deepEqual(link,{name:'assignment.html',href:'blob:test',connected:true});assert.equal(w.document.querySelector('a'),null);
  w.close();
});
test('download helper rejects revoked access without creating a download',async()=>{
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=dom.window;let ended=0;
  w.fetch=async()=>({ok:false,status:403,json:async()=>({error:'Access disabled'})});
  w.addEventListener('access-ended',()=>ended++);w.eval(script);
  await assert.rejects(()=>w.downloadForTest('alumnos/a1/docs/d1','doc.txt'),/Access disabled/);
  assert.equal(ended,1);assert.equal(w.document.querySelector('a'),null);w.close();
});
