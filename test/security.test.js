import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { emailKey, verifyCorporateClaims, mutationUpdates, validateData } from '../server/policy.js';

const origin='https://school.example';
const admin={id:'uadmin',nombre:'Dirección',email:'admin@thepower.education',roles:['director'],activo:true,grupos:[],materias:[],googleSub:'sub-admin'};
const tutor={id:'ututor',nombre:'Tutor',email:'tutor@prometeo-fp.com',roles:['tutor'],activo:true,grupos:['A'],materias:[],googleSub:'sub-tutor'};
const prof={id:'uprof',nombre:'Profesor',email:'prof@ext.thepower.education',roles:['profesor'],activo:true,grupos:[],materias:['Math'],googleSub:'sub-prof'};
function fixture() {
  let root={access:Object.fromEntries([admin,tutor,prof].map(u=>[emailKey(u.email),u.id])),app:{
    usuarios:{uadmin:admin,ututor:tutor,uprof:prof},grupos:['A','B'],asignaturas:['Math','History'],
    config:{schoolName:'Centro',curso:'2026–2027',emailjs:{publicKey:'secret'},evaluaciones:{1:{apertura:'2020-01-01'}}},
    asignaciones:{A:{asignaturas:['Math','History'],profesores:{Math:'uprof'}},B:{asignaturas:['Math'],profesores:{Math:'someone'}}},
    alumnos:{a1:{id:'a1',nombre:'Ana',apellidos:'Prueba',grupo:'A',dni:'private'},a2:{id:'a2',nombre:'Bea',grupo:'B'}},
    notas:{a1:{1:{Math:8,History:9}},a2:{1:{Math:3}}},
    tareas:{a1:{t1:{id:'t1',materia:'Math',desc:'Homework'},t2:{id:'t2',materia:'History'}}},
    auditoria:{},fctAsignaciones:{f1:{alumnos:['a1'],empId:'e1'},f2:{alumnos:['a1','a2'],empId:'e2'}},empresas:{e1:{nombre:'Company'},e2:{nombre:'Private'}}
  }};
  root=structuredClone(root);
  const store={read:async()=>structuredClone(root),transaction:async fn=>{root=fn(structuredClone(root));return structuredClone(root);}};
  const verifyIdentity=async req => {
    if (req.get('x-test-identity')==='invalid') {const e=new Error('Invalid signature');e.status=401;throw e;}
    const who={admin,tutor,prof}[req.get('x-test-identity')];
    if(!who){const e=new Error('Missing IAP');e.status=401;throw e;}
    return {email:who.email,sub:who.googleSub};
  };
  const app=createApp({store,verifyIdentity,origin});
  const call=(method,url,who='admin')=>request(app)[method](url).set('x-test-identity',who).set('Origin',origin).set('X-Requested-With','student-manager');
  return {app,call,root:()=>structuredClone(root)};
}
test('accepts the three exact corporate Workspace domains, rejects lookalikes and personal Google',()=>{
  for(const domain of ['thepower.education','ext.thepower.education','prometeo-fp.com']) assert.equal(verifyCorporateClaims({sub:'1',email_verified:true,hd:domain,email:'a@'+domain}).email,'a@'+domain);
  for(const claims of [{sub:'1',email_verified:true,email:'a@thepower.education'}, {sub:'1',email_verified:false,hd:'thepower.education',email:'a@thepower.education'}, {sub:'1',email_verified:true,hd:'thepower.education.evil',email:'a@thepower.education.evil'}]) assert.throws(()=>verifyCorporateClaims(claims));
});
test('rejects API calls without signed identity, even with unsigned Google email headers',async()=>{
  const {app}=fixture();
  await request(app).get('/api/database').set('x-goog-authenticated-user-email',admin.email).expect(401);
});
test('rejects invalid identity',async()=>{await fixture().call('get','/api/session','invalid').expect(401);});
test('tutor cannot read another group or server access index',async()=>{
  const {call}=fixture();
  const r=await call('get','/api/database','tutor').expect(200);
  assert.deepEqual(Object.keys(r.body.value.alumnos),['a1']);
  assert.equal(r.body.value.access,undefined);assert.equal(r.body.value.config.emailjs,undefined);
  await call('get','/api/database?path=access','tutor').expect(403);
  assert.equal((await call('get','/api/database?path=alumnos/a2','tutor')).body.value,null);
});
test('teacher sees only assigned modules and no DNI or family documents',async()=>{
  const {call}=fixture();const r=await call('get','/api/database','prof').expect(200);
  assert.deepEqual(r.body.value.notas.a1[1],{Math:8});assert.equal(r.body.value.alumnos.a1.dni,undefined);
  assert.deepEqual(Object.keys(r.body.value.tareas.a1),['t1']);assert.equal(r.body.value.alumnos.a2,undefined);
});
test('FCT reads exclude mixed groups and unrelated companies',async()=>{
  const r=await fixture().call('get','/api/database','tutor');
  assert.deepEqual(Object.keys(r.body.value.fctAsignaciones),['f1']);assert.deepEqual(Object.keys(r.body.value.empresas),['e1']);
});
test('cannot self-promote through database writes or user endpoints',async()=>{
  const {call}=fixture();
  await call('post','/api/database','tutor').send({path:'usuarios/ututor/roles',op:'set',value:['director']}).expect(403);
  await call('post','/api/users','tutor').send({nombre:'Tutor',email:tutor.email,roles:['director'],activo:true}).expect(403);
  await call('post','/api/database','tutor').send({path:'uidIndex/test',op:'set',value:'uadmin'}).expect(403);
});
test('teacher writes assigned grades; atomic multi-path update rejects other modules',async()=>{
  const {call,root}=fixture();
  await call('post','/api/database','prof').send({path:'/',op:'update',value:{'notas/a1/1/Math':7}}).expect(200);
  await call('post','/api/database','prof').send({path:'/',op:'update',value:{'notas/a1/1/Math':4,'notas/a1/1/History':2}}).expect(403);
  assert.equal(root().app.notas.a1[1].Math,7);
});
test('cannot smuggle another module by replacing a grade parent',async()=>{
  await fixture().call('post','/api/database','prof').send({path:'notas/a1/1',op:'set',value:{Math:1,History:1}}).expect(403);
});
test('teacher cannot move a task into another module',async()=>{
  await fixture().call('post','/api/database','prof').send({path:'tareas/a1/t1',op:'update',value:{materia:'History'}}).expect(403);
});
test('teacher cannot create or move students; tutor can update personal text but not group',async()=>{
  const {call}=fixture();
  await call('post','/api/database','prof').send({path:'alumnos/a1/nombre',op:'set',value:'New'}).expect(403);
  await call('post','/api/database','tutor').send({path:'alumnos/a1',op:'update',value:{nombre:'Updated'}}).expect(200);
  await call('post','/api/database','tutor').send({path:'alumnos/a1',op:'update',value:{grupo:'B'}}).expect(403);
});
test('admin can create, deactivate and reactivate users; current sessions lose access immediately',async()=>{
  const {call}=fixture();
  await call('delete','/api/users/ututor').expect(200);
  await call('get','/api/session','tutor').expect(403);
  await call('get','/api/database','tutor').expect(403);
  await call('post','/api/users').send({id:'ututor',nombre:'Tutor',email:tutor.email,roles:['tutor'],grupos:['A'],materias:[],activo:true}).expect(200);
  await call('get','/api/session','tutor').expect(200);
});
test('changes to roles apply on the next call',async()=>{
  const {call}=fixture();
  await call('post','/api/users').send({id:'ututor',nombre:'Tutor',email:tutor.email,roles:['profesor'],grupos:[],materias:[],activo:true}).expect(200);
  await call('post','/api/database','tutor').send({path:'alumnos/a1/nombre',op:'set',value:'Denied'}).expect(403);
});
test('protects last active administrator from demotion and deletion',async()=>{
  const {call}=fixture();
  await call('delete','/api/users/uadmin').expect(409);
  await call('post','/api/users').send({id:'uadmin',nombre:'Admin',email:admin.email,roles:['profesor'],activo:true}).expect(409);
});
test('user creation rejects external domains, passwords, family roles and duplicate emails',async()=>{
  const {call}=fixture();
  for(const body of [{email:'x@gmail.com',roles:['director']},{email:'x@thepower.education',roles:['alumno']},{email:'x@thepower.education',roles:['director'],pass:'secret'}]) await call('post','/api/users').send({nombre:'X',activo:true,...body}).expect(body.pass ? 400 : body.email.endsWith('gmail.com') ? 403 : 400);
  await call('post','/api/users').send({nombre:'Dup',email:admin.email,roles:['director'],activo:true}).expect(409);
});
test('blocks CSRF on same-origin and cross-origin writes',async()=>{
  const {app}=fixture();
  await request(app).post('/api/database').set('x-test-identity','admin').send({path:'config/a',op:'set',value:1}).expect(403);
  await request(app).post('/api/database').set('x-test-identity','admin').set('Origin','https://evil.example').set('X-Requested-With','student-manager').send({path:'config/a',op:'set',value:1}).expect(403);
});
test('audits committed changes on server, cannot overwrite audit',async()=>{
  const {call,root}=fixture();
  await call('post','/api/database').send({path:'config/schoolName',op:'set',value:'New Center'}).expect(200);
  const records=Object.values(root().app.auditoria);assert.equal(records[0].userId,'uadmin');assert.equal(records[0].tipo,'Cambio de datos');
  await call('post','/api/database').send({path:'auditoria',op:'set',value:{}}).expect(403);
});
test('rejects HTML payloads, executable data URLs, traversal and overlapping updates',()=>{
  for(const v of ['<img src=x onerror=alert(1)>','data:text/html;base64,PGh0bWw+']) assert.throws(()=>validateData(v));
  for(const path of ['__proto__/polluted','config/../users','config//name']) assert.throws(()=>mutationUpdates(path,'set','bad'));
  assert.throws(()=>mutationUpdates('/','update',{'notas/a1':{},'notas/a1/1':4}));
  assert.throws(()=>mutationUpdates('/','set',{}));
});
test('administrator can use formerly missing academic nodes',async()=>{
  const {call}=fixture();
  for(const node of ['rubricas','archivoCursos','grupoSiguiente','salidas']) await call('post','/api/database').send({path:node+'/entry',op:'set',value:{nombre:'Entry'}}).expect(200);
});
test('server enforces grade range and attendance values',async()=>{
  const {call}=fixture();
  for(const value of [-1,11,'bad']) await call('post','/api/database').send({path:'notas/a1/1/Math',op:'set',value}).expect(400);
  await call('post','/api/database').send({path:'faltas/a1/sesiones/2026-10-08_A_Math',op:'set',value:'invalid'}).expect(400);
  await call('post','/api/database').send({path:'faltas/a1/sesiones/2026-10-08_A_Math',op:'set',value:'A'}).expect(200);
});
