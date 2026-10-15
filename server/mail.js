import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {fail,isDirector,dataView,pathParts,safeKey,sessionModule} from './policy.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const madridDate=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
function singleKey(value) {if(typeof value!=='string'||pathParts(value).length!==1)fail(400,'Identificador inválido.');return value;}
function roles(user) {return user.roles||[user.rol];}
function minor(student,now) {
  const dob=student.fecha;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dob||''))return false;
  const birth=new Date(dob+'T00:00:00Z');
  if(!Number.isFinite(+birth)||birth.toISOString().slice(0,10)!==dob)return false;
  const today=madridDate(now);let age=+today.slice(0,4)-+dob.slice(0,4);if(today.slice(5)<dob.slice(5))age--;
  return age>=0&&age<18;
}
export function notificationPlan(root,user,input,now=Date.now()) {
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['kind','aid','tid','sesKey','force'].includes(k)))fail(400,'Petición de correo inválida.');
  if(input.force!==undefined&&typeof input.force!=='boolean')fail(400,'Reenvío inválido.');
  if(input.force&&!isDirector(user))fail(403,'Solo dirección puede forzar un reenvío.');
  const aid=singleKey(input.aid), student=root.app?.alumnos?.[aid], view=dataView(user,root.app||{});
  if(!student||!view.alumnos?.[aid])fail(403,'Sin permiso para este alumno.');
  const contacts=Object.values(root.migrationQuarantine?.usuarios||{}).filter(u=>(u.alumnosIds||[]).includes(aid));
  const recipients=[],notes=[];
  const add=(email,destino)=>{if(typeof email!=='string'||!email.trim())return;email=email.trim().toLowerCase();if(!/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)||email.length>254){notes.push('Hay una dirección de correo inválida en la ficha.');return;}if(!recipients.some(r=>r.email===email))recipients.push({email,destino});};
  const isMinor=minor(student,now), name=[student.nombre,student.apellidos].filter(Boolean).join(' ');
  let event,subject,text;
  if(input.kind==='task') {
    const tid=singleKey(input.tid), task=root.app.tareas?.[aid]?.[tid];
    if(!task||!view.tareas?.[aid]?.[tid])fail(403,'Sin permiso para esta tarea.');
    const date=task.fecha, delta=(Date.parse(date+'T00:00:00Z')-Date.parse(madridDate(now)+'T00:00:00Z'))/86400000;
    if(task.estado!=='Pendiente'||!Number.isFinite(delta)||delta<0||delta>3)fail(409,'La tarea ya no está pendiente o no vence en los próximos tres días.');
    add(student.emailAlumno,'alumno/a');
    if(!student.emailAlumno?.trim())for(const c of contacts)if(roles(c).includes('alumno'))add(c.email,'alumno/a');
    if(isMinor) {add(student.emailTutor,'tutor/a legal');if(!student.emailTutor?.trim())for(const c of contacts)if(roles(c).includes('tutorlegal'))add(c.email,'tutor/a legal');}
    if(!student.fecha)notes.push('Sin fecha de nacimiento: no se avisa al tutor legal.');
    event='tarea-'+tid;subject='Recordatorio de tarea pendiente · The Power FP Zaragoza';
    text=`Hola:\n\n${name} tiene una tarea pendiente de ${task.materia||'su módulo'}, con fecha de entrega ${date}.\n\n${String(task.desc||'').slice(0,3000)}\n\nSi ya se ha entregado, contacta con el centro para revisar su estado.\n\nThe Power FP Zaragoza`;
  } else if(input.kind==='absence') {
    const key=singleKey(input.sesKey), module=sessionModule(root.app,student.grupo,key), date=key.slice(0,10);
    if(!module||view.faltas?.[aid]?.sesiones?.[key]!=='A'||root.app.faltas?.[aid]?.sesiones?.[key]!=='A')fail(403,'La ausencia no está registrada o no corresponde a tus módulos.');
    if(!isMinor)return {aid,kind:input.kind,event:key,recipients:[],skipReason:'no-aplica',notes:['Los avisos de faltas al tutor legal solo se envían para menores con fecha de nacimiento válida.']};
    add(student.emailTutor,'tutor/a legal');if(!student.emailTutor?.trim())for(const c of contacts)if(roles(c).includes('tutorlegal'))add(c.email,'tutor/a legal');
    event=key;subject='Aviso de ausencia · The Power FP Zaragoza';text=`Hola:\n\nSe ha registrado una ausencia de ${name} en ${module}, el ${date}.\n\nSi necesitas justificarla o revisar este registro, contacta con el centro.\n\nThe Power FP Zaragoza`;
  } else fail(400,'Tipo de aviso inválido.');
  if(!recipients.length)notes.push('No hay destinatarios válidos registrados para este aviso.');
  return {aid,kind:input.kind,event,subject,text,recipients,notes,force:input.force===true};
}
export function mountMailRoutes({app,store,mail,verifyIdentity,resolveUser}) {
  const director=req=>{if(!isDirector(req.user))fail(403,'Solo dirección puede configurar el correo.');};
  const provider=()=>{if(!mail)fail(503,'El correo no está configurado.');return mail;};
  app.get('/api/mail/status',async(req,res)=>{director(req);res.json(mail?await mail.status():{configured:false,connected:false,enabled:false});});
  app.post('/api/mail/connect',async(req,res)=>{
    director(req);const state=randomBytes(32).toString('base64url'), verifier=randomBytes(48).toString('base64url');
    const url=await provider().authorize(state,createHash('sha256').update(verifier).digest('base64url'));
    await store.transaction(root=>{const actor=resolveUser(root,req.identity);if(!isDirector(actor))fail(403,'Solo dirección puede configurar el correo.');root.mailOAuthStates||={};for(const [key,v]of Object.entries(root.mailOAuthStates))if(v.expiresAt<Date.now())delete root.mailOAuthStates[key];root.mailOAuthStates[hash(state)]={sub:req.identity.sub,expiresAt:Date.now()+600000,verifier};return root;});
    res.json({url});
  });
  app.get('/oauth/gmail/callback',async(req,res,next)=>{
    try {
      const identity=await verifyIdentity(req);const claims={...identity,email:identity.email?.trim().toLowerCase()};
      if(typeof req.query.state!=='string'||typeof req.query.code!=='string'||req.query.state.length>200||req.query.code.length>4096)fail(400,'La autorización de Google no se ha completado.');
      let verifier;
      await store.transaction(root=>{const actor=resolveUser(root,claims), key=hash(req.query.state),state=root.mailOAuthStates?.[key];if(!isDirector(actor)||!state||state.sub!==claims.sub||state.expiresAt<Date.now())fail(403,'La solicitud ha caducado. Vuelve a conectar el correo desde la aplicación.');verifier=state.verifier;delete root.mailOAuthStates[key];return root;});
      await provider().connect(req.query.code,verifier);
      res.redirect('/?mail=connected');
    }catch(error){if(error.status)next(error);else next(Object.assign(new Error('No se ha podido conectar Google. Repite la autorización desde Configuración → Correo.'),{status:502}));}
  });
  app.post('/api/mail/notifications',async(req,res)=>{
    const initial=notificationPlan(req.root,req.user,req.body);
    if(!initial.recipients.length)return res.json({ok:false,motivo:initial.skipReason||'sin-email',notas:initial.notes});
    const current=await provider().status();if(!current.enabled||!current.connected)fail(503,'Falta autorizar el correo en Configuración → Correo.');
    const sent=[],errors=[],skipped=[];
    for(const recipient of initial.recipients) {
      const key=hash(JSON.stringify([initial.aid,initial.kind,initial.event,recipient.email])), attempt=randomUUID();let plan,claimed=false,blockedReason;
      await store.transaction(root=>{
        claimed=false;blockedReason=undefined;const actor=resolveUser(root,req.identity);plan=notificationPlan(root,actor,req.body);
        if(!plan.recipients.some(r=>r.email===recipient.email))fail(409,'Los destinatarios han cambiado. Revisa la ficha.');
        const previous=root.mailOutbox?.[key];
        if(['sending','unknown'].includes(previous?.status)){blockedReason='Hay un envío pendiente o sin confirmar. Dirección debe revisarlo antes de reenviar.';return root;}
        if(!plan.force&&previous?.status==='sent'&&Date.now()-previous.ts<86400000)return root;
        // A failure before Gmail accepted the message can be retried, with a short cooldown.
        if(previous?.status==='failed'&&Date.now()-previous.ts<60000){blockedReason='El intento anterior ha fallado. Espera un minuto antes de volver a intentarlo.';return root;}
        root.mailOutbox||={};root.mailOutbox[key]={aid:plan.aid,event:plan.event,kind:plan.kind,recipient:recipient.email,actorId:actor.id,status:'sending',attempt,ts:Date.now()};claimed=true;return root;
      });
      if(!claimed){if(blockedReason)errors.push(blockedReason);else skipped.push(recipient.destino);continue;}
      let messageId,error;
      try{messageId=await mail.send({to:recipient.email,subject:plan.subject,text:plan.text});}catch(e){error=e;}
      await store.transaction(root=>{
        const item=root.mailOutbox?.[key];if(!item||item.attempt!==attempt)fail(409,'El registro de correo ha cambiado.');
        item.status=error?(error.uncertain?'unknown':'failed'):'sent';item.ts=Date.now();if(messageId)item.messageId=messageId;
        const student=root.app?.alumnos?.[plan.aid];if(student){student.emails||={};student.emails[key]={ts:item.ts,fecha:madridDate(),asunto:plan.subject,destino:recipient.email,sesKey:plan.event,ok:!error,estado:item.status,...(messageId?{messageId}:{})};}
        root.app.auditoria||={};root.app.auditoria[randomUUID()]={ts:item.ts,userId:req.user.id,userNombre:req.user.nombre,tipo:'Correo',detalle:`${plan.kind}: ${plan.aid}; ${item.status}; ${key}`};return root;
      });
      if(error)errors.push(error.message);else sent.push(recipient.destino);
    }
    res.json({ok:sent.length>0&&!errors.length,destinos:sent,notas:initial.notes,enviados:sent.length,saltados:skipped.length,...(errors.length?{motivo:'error-envio',detalle:errors[0]}:!sent.length?{motivo:'ya-enviado'}:{})});
  });
}
