import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import request from 'supertest';
import {createApp} from '../server/app.js';
import {emailKey} from '../server/policy.js';
import {decodeFile,prepareFiles} from '../server/files.js';
const origin='https://school.example';
const admin={id:'uadmin',nombre:'Admin',email:'admin@thepower.education',roles:['director'],activo:true,googleSub:'admin'};
const prof={id:'uprof',nombre:'Teacher',email:'teacher@thepower.education',roles:['profesor'],grupos:[],materias:['Math'],activo:true,googleSub:'teacher'};
const html='data:text/html;base64,'+Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
const doc='data:text/plain;base64,'+Buffer.from('private homework').toString('base64');
function fixture() {
  let root={app:{usuarios:{uadmin:admin,uprof:prof},grupos:['A','B'],asignaturas:['Math'],asignaciones:{A:{asignaturas:['Math'],profesores:{Math:'uprof'}}},alumnos:{a1:{id:'a1',nombre:'A',apellidos:'Test',grupo:'A'},a2:{id:'a2',nombre:'B',apellidos:'Test',grupo:'B'}},tareas:{a1:{t1:{id:'t1',materia:'Math'}},a2:{t2:{id:'t2',materia:'Math'}}}},access:{[emailKey(admin.email)]:'uadmin',[emailKey(prof.email)]:'uprof'}};
  root=structuredClone(root);const contents=new Map();let saves=0;
  const store={read:async()=>structuredClone(root),transaction:async fn=>{root=fn(structuredClone(root));return structuredClone(root);}};
  const fileStore={save:async f=>{saves++;contents.set(f.id,f.bytes);return {object:'files/'+f.id,sha256:f.id,size:f.size};},stream:id=>Readable.from(contents.get(id))};
  const verifyIdentity=async req=>{const user=req.get('x-user')==='teacher'?prof:admin;return {sub:user.googleSub,email:user.email};};
  const app=createApp({store,fileStore,verifyIdentity,origin});
  const call=(method,url,user='admin')=>request(app)[method](url).set('Origin',origin).set('X-Requested-With','student-manager').set('x-user',user);
  return {call,root:()=>structuredClone(root),saved:()=>saves,contents};
}
test('files support imported HTML/TXT/ZIP/octet-stream as downloaded bytes, never markup in database',()=>{
  for(const mime of ['text/html','text/plain','application/x-zip-compressed','application/octet-stream']) {
    const result=prepareFiles({data:'data:'+mime+';base64,'+Buffer.from('bytes').toString('base64'),nombre:'file'});
    assert.equal(result.value.data,undefined);assert.match(result.value.fileId,/^[a-f0-9]{64}$/);assert.equal(result.objects.size,1);
  }
  assert.throws(()=>decodeFile('data:text/html;base64,!invalid'));
  assert.throws(()=>decodeFile('data:text/html;base64,YQ==',0));
});
test('upload stores metadata only; HTML downloads have forced attachment and nosniff',async()=>{
  const {call,root}=fixture();
  await call('post','/api/database').send({path:'tareas/a1/t1/archivoProf',op:'set',value:{nombre:'assignment.html',data:html}}).expect(200);
  assert.equal(root().app.tareas.a1.t1.archivoProf.data,undefined);
  assert.ok(root().app.tareas.a1.t1.archivoProf.fileId);assert.ok(root().files);
  const response=await call('get','/api/files?path=tareas/a1/t1/archivoProf').expect(200);
  assert.match(response.headers['content-disposition'],/^attachment;/);
  assert.equal(response.headers['content-type'],'application/octet-stream');assert.equal(response.headers['x-content-type-options'],'nosniff');
  assert.equal(Buffer.from(response.body).toString(),'<html><script>alert(1)</script></html>');
});
test('permission is checked before uploading; other-group download and forged file IDs are denied',async()=>{
  const {call,root,saved}=fixture();
  await call('post','/api/database','teacher').send({path:'tareas/a2/t2/archivoProf',op:'set',value:{nombre:'private.txt',data:doc}}).expect(403);
  assert.equal(saved(),0);
  await call('post','/api/database').send({path:'tareas/a2/t2/archivoProf',op:'set',value:{nombre:'private.txt',data:doc}}).expect(200);
  const ref=root().app.tareas.a2.t2.archivoProf;
  await call('get','/api/files?path=tareas/a2/t2/archivoProf','teacher').expect(404);
  await call('post','/api/database','teacher').send({path:'tareas/a1/t1/archivoProf',op:'set',value:ref}).expect(403);
  await call('get','/api/database?path=files','teacher').expect(403);
});
test('cannot bypass file-reference checks with a leaf write',async()=>{
  const {call,root}=fixture();
  await call('post','/api/database').send({path:'tareas/a1/t1/archivoProf',op:'set',value:{nombre:'ok.txt',data:doc}}).expect(200);
  await call('post','/api/database').send({path:'tareas/a2/t2/archivoProf',op:'set',value:{nombre:'hidden.html',data:html}}).expect(200);
  const hidden=root().app.tareas.a2.t2.archivoProf.fileId;
  await call('post','/api/database','teacher').send({path:'tareas/a1/t1/archivoProf/fileId',op:'set',value:hidden}).expect(403);
});
test('role removal cuts downloads from an existing session',async()=>{
  const {call}=fixture();
  await call('post','/api/database','teacher').send({path:'tareas/a1/t1/archivoProf',op:'set',value:{nombre:'ok.txt',data:doc}}).expect(200);
  await call('get','/api/files?path=tareas/a1/t1/archivoProf','teacher').expect(200);
  await call('delete','/api/users/uprof').expect(200);
  await call('get','/api/files?path=tareas/a1/t1/archivoProf','teacher').expect(403);
});
