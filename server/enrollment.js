import {randomUUID} from 'node:crypto';
import {fail,isDirector,validateData,validateAcademicChanges,validateUser,emailKey} from './policy.js';

// Student record and portal account are committed together, including shared families.
export function enroll(root,actor,body) {
  if(!isDirector(actor))fail(403,'Solo dirección puede dar de alta alumnos y accesos.');
  if(!body||Object.keys(body).some(k=>!['alumno','accessRole','accessName'].includes(k)))fail(400,'Alta inválida.');
  const {alumno,accessRole,accessName}=body;
  if(!alumno||Array.isArray(alumno)||Object.keys(alumno).some(k=>!['id','nombre','apellidos','grupo','fecha','obs','expediente','emailTutor','emailAlumno','dni','ss'].includes(k)))fail(400,'Ficha de alumno inválida.');
  validateData(alumno);
  if(!/^a[a-zA-Z0-9-]{1,80}$/.test(alumno.id||''))fail(400,'ID de alumno inválido.');
  if(!['alumno','tutorlegal'].includes(accessRole))fail(400,'Elige acceso de Alumno o Tutor legal (Familia).');
  if(Object.hasOwn(root.app.alumnos||{},alumno.id))fail(409,'Este alumno ya está guardado. Recarga el listado.');
  const next={...root.app,alumnos:{...root.app.alumnos,[alumno.id]:alumno}};
  validateAcademicChanges(root.app,next,{['alumnos/'+alumno.id]:alumno});
  const input=validateUser({nombre:accessRole==='alumno'?`${alumno.nombre} ${alumno.apellidos}`:accessName,email:accessRole==='alumno'?alumno.emailAlumno:alumno.emailTutor,roles:[accessRole],alumnosIds:[alumno.id],activo:true},'u'+randomUUID());
  const users=root.app.usuarios||{},existing=Object.values(users).find(u=>u.email===input.email);
  if(existing){
    if(accessRole!=='tutorlegal'||existing.roles?.length!==1||existing.roles[0]!=='tutorlegal')fail(409,'Este correo ya tiene una cuenta. Usa otro correo o revisa el perfil en Usuarios.');
    if(existing.activo!==true)fail(409,'La cuenta de esta familia está desactivada. Revísala en Usuarios antes de vincularla.');
    input.id=existing.id;input.nombre=existing.nombre;input.alumnosIds=[...new Set([...(existing.alumnosIds||[]),alumno.id])];
    if(input.alumnosIds.length>100)fail(400,'La familia supera el límite de alumnos vinculados.');
  }
  root.app.alumnos=next.alumnos;
  root.app.faltas||={};root.app.faltas[alumno.id]=Object.fromEntries([[9,22],[10,23],[11,21],[12,17],[1,21],[2,20],[3,21],[4,17],[5,22],[6,20]].map(([month,days])=>[month,Object.fromEntries(Array.from({length:days},(_,day)=>[day+1,'P']))]));
  root.app.usuarios||={};root.app.usuarios[input.id]=input;
  root.access||={};root.access[emailKey(input.email)]=input.id;
  root.app.auditoria||={};root.app.auditoria[randomUUID()]={ts:Date.now(),userId:actor.id,userNombre:actor.nombre,tipo:'Alta de alumno y acceso',detalle:`Alumno ${alumno.id}; usuario ${input.id}; rol ${accessRole}; ${existing?'familia vinculada':'cuenta creada'}`};
  return input;
}
