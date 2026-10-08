import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {JSDOM} from 'jsdom';
import createDOMPurify from 'dompurify';
const source=readFileSync('client/sanitize.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
const handlerSource=readFileSync('dist/client/handlers.js','utf8').replace('export ','');
function windowForTest() {
  const dom=new JSDOM('<body><div id="container"></div><table><tbody id="rows"></tbody></table></body>',{runScripts:'outside-only'});
  const w=dom.window;w.DOMPurify=createDOMPurify(w);w.parse=parse;
  w.eval(handlerSource+'\n'+source+'\nwindow.testSafeHandler=safeHandler;');
  return w;
}
test('HTML sanitizer removes executable markup and keeps table rows',()=>{
  const w=windowForTest(), c=w.document.getElementById('container');
  c.innerHTML='<script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">Bad</a><iframe srcdoc="<script>alert(1)</script>"></iframe>';
  assert.equal(c.querySelector('script'),null);assert.equal(c.querySelector('iframe'),null);
  assert.equal(c.querySelector('img').getAttribute('onerror'),null);assert.equal(c.querySelector('a').getAttribute('href'),null);
  w.document.getElementById('rows').innerHTML='<tr><td>Alumno</td></tr>';
  assert.equal(w.document.querySelectorAll('#rows tr td').length,1);w.close();
});
test('sanitizer retains known controls and rejects JS injected into an event',()=>{
  const w=windowForTest();
  for(const value of ["saveNotas();fetch('/api/users')","window['alert'](1)","saveNotas();saveUsuario()","saveNotas(saveUsuario())","location.assign('https://evil.example')","this.constructor.constructor('alert(1)')()"] ) assert.equal(w.testSafeHandler(value),false,value);
  assert.equal(w.testSafeHandler("editUsuario('u123')"),true);
  assert.equal(w.testSafeHandler("saveNotas()"),true);
  w.document.getElementById('container').innerHTML='<button onclick="saveNotas()">Save</button><button onclick="alert(1)">Bad</button>';
  assert.equal(w.document.querySelectorAll('button[onclick]').length,1);w.close();
});
test('compiled interpolation helpers prevent quote injection in attributes and JS arguments',()=>{
  const w=windowForTest();
  const compiled=readFileSync('dist/client/app.js','utf8').split('\n').slice(0,2).join('\n');
  w.eval(compiled+'\nwindow.testEscAttr=escAttr;window.testEscHandler=escHandlerArg;');
  const data='\" autofocus onclick=\"saveUsuario()';
  w.document.getElementById('container').innerHTML='<input value="'+w.testEscAttr(data)+'">';
  assert.equal(w.document.querySelector('input').value,data);assert.equal(w.document.querySelector('input').getAttribute('onclick'),null);
  const poisoned="x');saveUsuario();//";
  w.document.getElementById('container').innerHTML='<button onclick="editUsuario(\''+w.testEscHandler(poisoned)+'\')">Edit</button>';
  const event=w.document.querySelector('button').getAttribute('onclick');
  assert.equal(parse(event,{ecmaVersion:2022}).body.length,1);
  assert.equal(parse(event,{ecmaVersion:2022}).body[0].expression.arguments[0].value,poisoned);w.close();
});
