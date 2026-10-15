import test from 'node:test';import assert from 'node:assert/strict';import request from 'supertest';
import {createApp} from '../server/app.js';import {emailKey} from '../server/policy.js';
import {notificationPlan,madridDate} from '../server/mail.js';import {createGmail,SEND_SCOPE,mimeMessage} from '../server/gmail.js';
const origin='https://school.test';
const admin={id:'ua',nombre:'Admin',email:'admin@thepower.education',roles:['director'],activo:true,googleSub:'sa'};
const teacher={id:'up',nombre:'Teacher',email:'prof@thepower.education',roles:['profesor'],activo:true,googleSub:'sp'};
function fixture(send=async()=> 'gmail-id') {
 let root={access:{[emailKey(admin.email)]:admin.id,[emailKey(teacher.email)]:teacher.id},app:{usuarios:{ua:admin,up:teacher},grupos:['A','B'],asignaturas:['Math','Other'],asignaciones:{A:{asignaturas:['Math','Other'],profesores:{Math:'up'}}},alumnos:{a:{id:'a',nombre:'Ana',grupo:'A',fecha:'2012-01-01',emailTutor:'family@example.com'},b:{id:'b',nombre:'Bea',grupo:'B',fecha:'2000-01-01'}},tareas:{a:{t:{estado:'Pendiente',materia:'Math',desc:'Exercise',fecha:madridDate()},other:{estado:'Pendiente',materia:'Other',fecha:madridDate()}},b:{t:{estado:'Pendiente',materia:'Math',fecha:madridDate()}}},faltas:{a:{sesiones:{[madridDate()+'_A_Math']:'A'}}}},migrationQuarantine:{usuarios:{old:{email:'pupil@students.thepower.education',roles:['alumno'],alumnosIds:['a']},family:{email:'family@example.com',rol:'tutorlegal',alumnosIds:['a']}}}};
 const store={read:async()=>structuredClone(root),transaction:async fn=>{root=fn(structuredClone(root));return structuredClone(root);}};
 const mail={sender:'thepowerfpzaragoza@thepower.education',status:async()=>({configured:true,connected:true,enabled:true}),authorize:async state=>'https://accounts.google.com/?state='+state,connect:async()=>{},send};
 const verifyIdentity=async req=>{const user=req.get('x-user')==='teacher'?teacher:admin;if(req.get('x-user')==='none')throw Object.assign(new Error('Missing identity'),{status:401});return {email:user.email,sub:user.googleSub};};
 const app=createApp({store,mail,origin,verifyIdentity});
 const call=(method,url,who='admin')=>request(app)[method](url).set('x-user',who).set('Origin',origin).set('X-Requested-With','student-manager');
 return {root:()=>root,mail,app,call};
}
test('task recipients use archived contacts without giving those accounts application access',()=>{
 const {root}=fixture();const p=notificationPlan(root(),teacher,{kind:'task',aid:'a',tid:'t'});assert.deepEqual(p.recipients.map(r=>r.email),['pupil@students.thepower.education','family@example.com']);assert.equal(root().access[emailKey('pupil@students.thepower.education')],undefined);
 root().app.alumnos.a.fecha='2000-01-01';assert.deepEqual(notificationPlan(root(),admin,{kind:'task',aid:'a',tid:'t'}).recipients.map(r=>r.email),['pupil@students.thepower.education']);
 delete root().app.alumnos.a.fecha;assert.equal(notificationPlan(root(),admin,{kind:'task',aid:'a',tid:'t'}).recipients.length,1);
});
test('notifications reject other groups/modules, arbitrary recipients, overdue/completed tasks and unrecorded absences',()=>{
 const {root}=fixture();for(const input of [{kind:'task',aid:'b',tid:'t'},{kind:'task',aid:'a',tid:'other'},{kind:'task',aid:'a',tid:'t',to:'attacker@example.com'},{kind:'absence',aid:'a',sesKey:madridDate()+'_A_Other'},{kind:'task',aid:'a',tid:'t',force:true}])assert.throws(()=>notificationPlan(root(),teacher,input));
 root().app.tareas.a.t.estado='Entregada';assert.throws(()=>notificationPlan(root(),admin,{kind:'task',aid:'a',tid:'t'}));root().app.tareas.a.t.estado='Pendiente';root().app.tareas.a.t.fecha='2020-01-01';assert.throws(()=>notificationPlan(root(),admin,{kind:'task',aid:'a',tid:'t'}));
});
test('absence recipients are deduplicated guardians of minors only',()=>{
 const {root}=fixture(),input={kind:'absence',aid:'a',sesKey:madridDate()+'_A_Math'};assert.deepEqual(notificationPlan(root(),teacher,input).recipients.map(r=>r.email),['family@example.com']);root().app.alumnos.a.fecha='2000-01-01';assert.equal(notificationPlan(root(),teacher,input).recipients.length,0);
});
test('only directors configure Gmail and OAuth callback requires expiring, single-use, actor-bound state',async()=>{
 const f=fixture();await f.call('get','/api/mail/status','teacher').expect(403);await f.call('post','/api/mail/connect','teacher').send({}).expect(403);
 await f.call('post','/api/mail/connect').send({}).expect(200);const [key,state]=Object.entries(f.root().mailOAuthStates)[0];assert.equal(state.sub,'sa');
 await f.call('get','/oauth/gmail/callback?state=forged&code=x').expect(403);
 await f.call('get','/api/mail/status','none').expect(401);assert.ok(key.length===64);
});
test('Gmail-accepted messages are recorded once; repeated and concurrent requests do not duplicate them',async()=>{
 let count=0;const f=fixture(async()=>{count++;await new Promise(r=>setTimeout(r,20));return 'id-'+count;});const body={kind:'task',aid:'a',tid:'t'};
 await Promise.all([f.call('post','/api/mail/notifications','teacher').send(body).expect(200),f.call('post','/api/mail/notifications','teacher').send(body).expect(200)]);assert.equal(count,2); // two separate recipients
 const again=await f.call('post','/api/mail/notifications').send(body).expect(200);assert.equal(again.body.motivo,'ya-enviado');assert.equal(count,2);
 assert.equal(Object.values(f.root().mailOutbox).filter(v=>v.status==='sent').length,2);assert.equal(Object.values(f.root().app.alumnos.a.emails).filter(v=>v.ok).length,2);
});
test('uncertain Gmail response is never recorded as sent or automatically retried',async()=>{
 let count=0;const f=fixture(async()=>{count++;throw Object.assign(new Error('Unconfirmed'),{uncertain:true});});const body={kind:'absence',aid:'a',sesKey:madridDate()+'_A_Math'};
 const first=await f.call('post','/api/mail/notifications').send(body).expect(200);assert.equal(first.body.ok,false);assert.equal(Object.values(f.root().mailOutbox)[0].status,'unknown');assert.equal(Object.values(f.root().app.alumnos.a.emails)[0].ok,false);
 await f.call('post','/api/mail/notifications').send({...body,force:true}).expect(200);assert.equal(count,1);
});
test('mail endpoints keep existing CSRF and deactivation protections',async()=>{
 const f=fixture();await request(f.app).post('/api/mail/notifications').set('x-user','admin').send({kind:'task',aid:'a',tid:'t'}).expect(403);f.root().app.usuarios.up.activo=false;await f.call('post','/api/mail/notifications','teacher').send({kind:'task',aid:'a',tid:'t'}).expect(403);
});
test('Gmail OAuth validates exact sender and send scope before persisting a refresh token',async()=>{
 let saved=false,identity={email_verified:true,email:'wrong@thepower.education'};
 const oauth={getToken:async()=>({tokens:{id_token:'opaque',refresh_token:'private',scope:SEND_SCOPE}}),verifyIdToken:async()=>({getPayload:()=>identity})};
 const mail=createGmail({origin,projectId:'test',sender:'sender@thepower.education',enabled:true,secrets:{read:async()=>({client_id:'client',client_secret:'private'}),write:async()=>{saved=true;}},clientFactory:()=>oauth});
 await assert.rejects(mail.connect('code','verifier'),/exactamente/);assert.equal(saved,false);identity.email='sender@thepower.education';await mail.connect('code','verifier');assert.equal(saved,true);
});
test('MIME messages reject header injection and encode Spanish text as plain text',()=>{
 assert.throws(()=>mimeMessage('sender@example.com','victim@example.com\r\nBcc: evil@example.com','Test','body'));
 const raw=Buffer.from(mimeMessage('sender@example.com','to@example.com','Aviso de ausencia','Línea <script>texto</script>'),'base64url').toString();assert.match(raw,/Content-Type: text\/plain/);assert.match(raw,/Content-Transfer-Encoding: base64/);assert.doesNotMatch(raw,/<script>/);
});

test('OAuth callback consumes state once, rejects another actor and expires old requests',async()=>{
 const f=fixture();let connections=0;f.mail.connect=async()=>{connections++;};
 const start=await f.call('post','/api/mail/connect').send({}).expect(200), state=new URL(start.body.url).searchParams.get('state');
 await f.call('get','/oauth/gmail/callback?state='+state+'&code=code','teacher').expect(403);assert.equal(connections,0);
 await f.call('get','/oauth/gmail/callback?state='+state+'&code=code').expect(302);assert.equal(connections,1);
 await f.call('get','/oauth/gmail/callback?state='+state+'&code=code').expect(403);
 const next=await f.call('post','/api/mail/connect').send({});const expired=new URL(next.body.url).searchParams.get('state');Object.values(f.root().mailOAuthStates)[0].expiresAt=0;
 await f.call('get','/oauth/gmail/callback?state='+expired+'&code=code').expect(403);assert.equal(connections,1);
});

test('edited contact details supersede historical addresses, without revealing guardians to teachers',()=>{
 const f=fixture();f.root().app.alumnos.a.emailAlumno='new-pupil@example.com';f.root().app.alumnos.a.emailTutor='new-family@example.com';
 const plan=notificationPlan(f.root(),teacher,{kind:'task',aid:'a',tid:'t'});assert.deepEqual(plan.recipients.map(r=>r.email),['new-pupil@example.com','new-family@example.com']);
});
