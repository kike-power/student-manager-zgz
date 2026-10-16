import test from 'node:test';import assert from 'node:assert/strict';import request from 'supertest';
import {Readable} from 'node:stream';
import {assertSubmission} from '../server/submissions.js';
import {createApp} from '../server/app.js';import {createPortalAuth} from '../server/portal-auth.js';
import {dataView,emailKey,validateUser} from '../server/policy.js';import {authorizedFile} from '../server/files.js';
const origin='http://localhost:8080';
const family={id:'ufamily',nombre:'Family',email:'family@hotmail.com',roles:['tutorlegal'],alumnosIds:['a1'],activo:true};
const student={id:'ustudent',nombre:'Student',email:'pupil@example.org',roles:['alumno'],alumnosIds:['a1'],activo:true};
const admin={id:'uadmin',nombre:'Admin',email:'admin@thepower.education',roles:['director'],activo:true,googleSub:'admin-sub'};
const fid='a'.repeat(64),otherFid='b'.repeat(64);
function fixture(){let time=Date.parse('2026-10-16T10:00:00Z'),messages=[],saves=0,saveHook=()=>{};
 let root={access:Object.fromEntries([family,student,admin].map(u=>[emailKey(u.email),u.id])),app:{usuarios:{ufamily:family,ustudent:student,uadmin:admin},grupos:['A','B'],asignaturas:['Math'],asignaciones:{A:{asignaturas:['Math'],profesores:{Math:'uadmin'}},B:{asignaturas:['Other']}},config:{schoolName:'Demo',curso:'2026–2027',repLegalNif:'private',evaluaciones:{1:{publicacion:'2020-01-01'},2:{publicacion:'2099-01-01'}}},alumnos:{a1:{id:'a1',nombre:'Ana',grupo:'A',dni:'private',emailTutor:'private',ss:'private',emails:{e:{destino:'private'}},docs:{doc:{fileId:fid,nombre:'note.pdf',size:4}}},a2:{id:'a2',nombre:'Bea',grupo:'B',docs:{doc:{fileId:otherFid,size:4}}}},faltas:{a1:{1:{1:'A'}},a2:{1:{1:'P'}}},tareas:{a1:{t:{id:'t',materia:'Math',desc:'Exercise',archivoProf:{fileId:fid,size:4}}},a2:{t:{id:'t',materia:'Other'}}},notas:{a1:{1:{Math:8},2:{Math:9}}},notasRA:{a1:{1:{Math:{r:8}},2:{Math:{r:9}}}},auditoria:{secret:{detalle:'private'}},disciplina:{a1:{secret:'private'}},observaciones:{a1:{secret:'private'}},avisos:{all:{publico:'todos',cuerpo:'Public'},family:{publico:'familias',cuerpo:'For families'},staff:{publico:'profesorado',cuerpo:'private'}},empresas:{secret:{}},fctAsignaciones:{secret:{}}},files:{[fid]:{object:'files/'+fid,sha256:fid,size:4},[otherFid]:{object:'files/'+otherFid,sha256:otherFid,size:4}}};root=structuredClone(root);
 const store={read:async()=>structuredClone(root),transaction:async fn=>{root=fn(structuredClone(root));return structuredClone(root);}};
 const mail={send:async input=>{messages.push(input);return 'mail-id';}};
 const portalAuth=createPortalAuth({secret:'private-test-key'.repeat(4),mail,now:()=>time});
 const app=createApp({store,mail,portalAuth,fileStore:{stream:()=>Readable.from('test'),save:async file=>{saves++;saveHook();return{object:'files/'+file.id,sha256:file.id,size:file.size};}},origin,production:false});
 const call=(method,path,cookie)=>{const r=request(app)[method](path).set('Origin',origin).set('X-Requested-With','student-manager');if(cookie)r.set('Cookie',cookie);return r;};
 async function login(email=family.email){await call('post','/api/auth/request-code').send({email}).expect(200);const code=messages.at(-1).text.match(/\b\d{8}\b/)[0];const result=await call('post','/api/auth/verify-code').send({email,code}).expect(200);return result.headers['set-cookie'][0].split(';')[0];}
 return {app,call,login,saves:()=>saves,onSave:fn=>{saveHook=fn;},root:()=>root,store,portalAuth,messages,now:()=>time,advance:ms=>{time+=ms;}};
}
test('family and pupil roles accept any email domain but staff still require a corporate address',()=>{
 for(const role of ['alumno','tutorlegal'])assert.equal(validateUser({nombre:'Name',email:'someone@other-domain.net',roles:[role],alumnosIds:['a1'],activo:true},'u1').email,'someone@other-domain.net');
 for(const roles of [['director'],['tutor'],['profesor'],['alumno','director'],['tutorlegal','profesor'],['alumno','tutorlegal']])assert.throws(()=>validateUser({nombre:'Name',email:'someone@gmail.com',roles,alumnosIds:['a1'],activo:true},'u1'));
 assert.throws(()=>validateUser({nombre:'Name',email:'a@b.com',roles:['alumno'],alumnosIds:['a1','a2'],activo:true},'u1'));
 assert.throws(()=>validateUser({nombre:'Name',email:'a@b.com',roles:['tutorlegal'],alumnosIds:[],activo:true},'u1'));
});
test('self-service views exclude other students, contact data, staff notices and unpublished evaluations',()=>{
 const f=fixture(),view=dataView(family,f.root().app);assert.deepEqual(Object.keys(view.alumnos),['a1']);
 for(const key of ['dni','ss','emails','emailTutor'])assert.equal(view.alumnos.a1[key],undefined);
 for(const key of ['auditoria','disciplina','observaciones','empresas','fctAsignaciones'])assert.equal(view[key],undefined);
 assert.equal(view.config.repLegalNif,undefined);assert.deepEqual(Object.keys(view.notas.a1),['1']);assert.deepEqual(Object.keys(view.notasRA.a1),['1']);assert.equal(view.avisos.staff,undefined);assert.ok(view.avisos.all);assert.ok(view.avisos.family);
 assert.equal(authorizedFile(family,f.root(),'alumnos/a1/docs/doc').id,fid);assert.throws(()=>authorizedFile(family,f.root(),'alumnos/a2/docs/doc'));assert.throws(()=>authorizedFile(family,f.root(),'orphans/secret',true));
});
test('unknown accounts and staff get the same request response without receiving a code',async()=>{
 const f=fixture();const valid=await f.call('post','/api/auth/request-code').send({email:family.email}).expect(200);
 for(const email of ['nobody@unrelated.net',admin.email]){const result=await f.call('post','/api/auth/request-code').send({email}).expect(200);assert.deepEqual(result.body,valid.body);}assert.equal(f.messages.length,1);
 await f.call('post','/api/auth/request-code').send({email:family.email}).expect(200);assert.equal(f.messages.length,1);
 assert.doesNotMatch(JSON.stringify(f.root().portalChallenges),new RegExp(f.messages[0].text.match(/\b\d{8}\b/)[0]));
});
test('OTP codes expire, are single-use and are limited to five attempts',async()=>{
 for(const mode of ['expire','attempts','reuse']){
  const f=fixture();await f.portalAuth.request(f.store,family.email);const code=f.messages[0].text.match(/\b\d{8}\b/)[0];
  if(mode==='expire'){f.advance(600001);await assert.rejects(f.portalAuth.verify(f.store,family.email,code));}
  if(mode==='attempts'){for(let i=0;i<5;i++)await assert.rejects(f.portalAuth.verify(f.store,family.email,code==='00000000'?'11111111':'00000000'));await assert.rejects(f.portalAuth.verify(f.store,family.email,code));}
  if(mode==='reuse'){assert.ok(await f.portalAuth.verify(f.store,family.email,code));await assert.rejects(f.portalAuth.verify(f.store,family.email,code));}
 }
});
test('portal requires a session and returns only linked data after verified email login',async()=>{
 const f=fixture();await f.call('get','/api/database').expect(401);const cookie=await f.login();
 await f.call('get','/api/files?path=alumnos/a1/docs/doc',cookie).expect(200);
 const result=await f.call('get','/api/database',cookie).expect(200);assert.deepEqual(Object.keys(result.body.value.alumnos),['a1']);
 assert.equal((await f.call('get','/api/session',cookie).expect(200)).body.user.alumnosIds[0],'a1');
 assert.equal((await f.call('get','/api/database?path=alumnos/a2',cookie).expect(200)).body.value,null);
 await f.call('get','/api/database?path=access',cookie).expect(403);await f.call('get','/api/files?path=alumnos/a2/docs/doc',cookie).expect(404);
});
test('students and families cannot mutate academic data, manage users, send notices or access administration',async()=>{
 for(const who of [family,student]){const f=fixture(),cookie=await f.login(who.email);
  for(const endpoint of ['/api/database','/api/users','/api/mail/notifications','/api/mail/connect'])await f.call('post',endpoint,cookie).send({path:'notas/a1/1/Math',op:'set',value:10}).expect(403);
  for(const endpoint of ['/api/migration/quarantine','/api/mail/status'])await f.call('get',endpoint,cookie).expect(403);
  await f.call('delete','/api/users/uadmin',cookie).expect(403);
 }
});
test('existing portal sessions lose access on deactivation, email or role change, expiry and logout',async()=>{
 for(const change of ['inactive','email','staff','expire','logout']){
  const f=fixture(),cookie=await f.login();
  if(change==='inactive')f.root().app.usuarios.ufamily.activo=false;
  if(change==='email')f.root().app.usuarios.ufamily.email='new@hotmail.com';
  if(change==='staff')f.root().app.usuarios.ufamily.roles=['director'];
  if(change==='expire')f.advance(8*3600000+1);
  if(change==='logout')await f.call('post','/api/auth/logout',cookie).send({}).expect(200);
  const response=await f.call('get','/api/database',cookie);assert.ok([401,403].includes(response.status));
 }
});
test('forged sessions, unsigned headers and cross-site code requests are rejected',async()=>{
 const f=fixture();await f.call('get','/api/database','__Host-student-portal='+ 'x'.repeat(43)).set('x-goog-authenticated-user-email',family.email).expect(401);
 await request(f.app).post('/api/auth/request-code').send({email:family.email}).expect(403);
 await f.call('post','/api/auth/request-code').set('Origin','https://attacker.test').send({email:family.email}).expect(403);
 assert.equal(f.messages.length,0);
});
test('only a director can create linked profiles; invalid student links and duplicate identities are rejected',async()=>{
 const f=fixture();const staff=createApp({store:f.store,origin,production:false,verifyIdentity:async()=>({email:admin.email,sub:admin.googleSub})});
 const create=body=>request(staff).post('/api/users').set('Origin',origin).set('X-Requested-With','student-manager').send(body);
 const body={nombre:'New Family',email:'parent@external.org',roles:['tutorlegal'],alumnosIds:['a2'],activo:true};
 await create({...body,alumnosIds:['missing']}).expect(400);await create(body).expect(200);await create(body).expect(409);
 const newProfile=Object.values(f.root().app.usuarios).find(u=>u.email===body.email);assert.deepEqual(newProfile.alumnosIds,['a2']);
});

const submission=(extra={})=>({alumnoId:'a1',tareaId:'t',action:'upload',file:{nombre:'entrega.txt',data:'data:text/plain;base64,'+Buffer.from('homework').toString('base64')},...extra});
test('pupil can upload, replace and withdraw own submission without changing staff fields',async()=>{
 const f=fixture(),cookie=await f.login(student.email);Object.assign(f.root().app.tareas.a1.t,{cal:8,obs:'Feedback',fecha:'2999-01-01'});
 await f.call('post','/api/submissions',cookie).send(submission()).expect(200);
 let task=f.root().app.tareas.a1.t;assert.equal(task.estado,'Entregada');assert.equal(task.entregaAuto,true);assert.equal(task.cal,8);assert.equal(task.obs,'Feedback');assert.equal(task.archivoAlumno.data,undefined);assert.ok(f.root().files[task.archivoAlumno.fileId]);assert.equal(task.archivoProf.fileId,fid);
 await f.call('post','/api/submissions',cookie).send(submission({file:{nombre:'replacement.pdf',data:'data:application/pdf;base64,'+Buffer.from('replacement').toString('base64')}})).expect(200);assert.equal(f.root().app.tareas.a1.t.archivoAlumno.nombre,'replacement.pdf');
 await f.call('post','/api/submissions',cookie).send({alumnoId:'a1',tareaId:'t',action:'delete'}).expect(200);task=f.root().app.tareas.a1.t;assert.equal(task.archivoAlumno,undefined);assert.equal(task.estado,'Pendiente');assert.equal(task.entregaFecha,undefined);assert.equal(task.cal,8);
});
test('family, another pupil, expired task and arbitrary fields cannot authorize a file upload',async()=>{
 for(const mode of ['family','other','expired','unknown','fields','reference']){
  const f=fixture(),cookie=await f.login(mode==='family'?family.email:student.email);let body=submission();
  if(mode==='other')body.alumnoId='a2';if(mode==='expired')f.root().app.tareas.a1.t.fecha='2000-01-01';if(mode==='unknown')body.tareaId='missing';if(mode==='fields')body.cal=10;if(mode==='reference')body.file={nombre:'stolen',fileId:otherFid};
  const response=await f.call('post','/api/submissions',cookie).send(body);assert.ok([400,403,404].includes(response.status),mode);assert.equal(f.saves(),0,mode);
 }
});
test('deadline uses Madrid midnight including daylight saving changes and allows tasks without a date',()=>{
 const f=fixture(),root=f.root(),task=root.app.tareas.a1.t;
 task.fecha='2026-10-16';assert.ok(assertSubmission(student,root,'a1','t',Date.parse('2026-10-16T21:59:59Z')));assert.throws(()=>assertSubmission(student,root,'a1','t',Date.parse('2026-10-16T22:00:00Z')));
 task.fecha='2026-10-25';assert.ok(assertSubmission(student,root,'a1','t',Date.parse('2026-10-25T22:59:59Z')));assert.throws(()=>assertSubmission(student,root,'a1','t',Date.parse('2026-10-25T23:00:00Z')));
 task.fecha='2026-02-30';assert.throws(()=>assertSubmission(student,root,'a1','t'));delete task.fecha;assert.ok(assertSubmission(student,root,'a1','t'));
});
test('upload rechecks authorization and deadline when committing and never registers a rejected file',async()=>{
 for(const mode of ['expired','inactive']){
 const f=fixture(),cookie=await f.login(student.email);f.onSave(()=>{if(mode==='expired')f.root().app.tareas.a1.t.fecha='2000-01-01';else f.root().app.usuarios.ustudent.activo=false;});
 const result=await f.call('post','/api/submissions',cookie).send(submission());assert.equal(result.status,403);assert.equal(f.root().app.tareas.a1.t.archivoAlumno,undefined);assert.equal(Object.keys(f.root().files).length,2);
 }
});
test('oversized or malformed submissions and expired withdrawals are refused',async()=>{
 const f=fixture(),cookie=await f.login(student.email);
 for(const data of ['data:text/plain;base64,INVALID!', 'data:text/plain;base64,'+Buffer.alloc(5*1024*1024+1).toString('base64')])await f.call('post','/api/submissions',cookie).send(submission({file:{nombre:'file.txt',data}})).expect(400);
 f.root().app.tareas.a1.t.fecha='2000-01-01';await f.call('post','/api/submissions',cookie).send({alumnoId:'a1',tareaId:'t',action:'delete'}).expect(403);assert.equal(f.saves(),0);
});
