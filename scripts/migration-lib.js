import { createHash } from 'node:crypto';
import { APP_NODES, DOMAINS, ROLES, emailKey, validateUser, validateData } from '../server/policy.js';
import { decodeFile, fileReferences } from '../server/files.js';

const CREDENTIAL_KEYS=new Set(['pass','password','passwordHash','salt','refreshToken','idToken']);
export function stripCredentials(value, counter={removed:0}) {
  if(!value || typeof value!=='object') return value;
  if(Array.isArray(value)) return value.map(v=>stripCredentials(v,counter));
  const result={};
  for(const [key,v] of Object.entries(value)) {
    if(CREDENTIAL_KEYS.has(key)) {counter.removed++;continue;}
    if(['__proto__','constructor','prototype'].includes(key)) throw new Error('El export contiene una clave insegura.');
    result[key]=stripCredentials(v,counter);
  }
  return result;
}
export function prepareMigration(source,{sourceSha256,adminEmails}) {
  if(!source || typeof source!=='object' || Array.isArray(source)) throw new Error('El export debe ser un objeto JSON.');
  const admins=new Set(adminEmails.map(e=>e.trim().toLowerCase()));
  if(!admins.size || [...admins].some(email=>!DOMAINS.includes(email.split('@')[1]))) throw new Error('Indica administradores corporativos válidos.');
  const credentials={removed:0};
  const cleaned=stripCredentials(source,credentials);
  const objects=new Map(), references=[];
  const externalize=(item,path=[])=>{
    if(!item || typeof item!=='object') {
      if(typeof item==='string' && item.startsWith('data:')) throw new Error('Hay un archivo sin un contenedor de metadatos.');
      return item;
    }
    if(Array.isArray(item)) return item.map((v,i)=>externalize(v,[...path,String(i)]));
    const result={};
    for(const [key,v] of Object.entries(item)) if(key!=='data' || typeof v!=='string' || !v.startsWith('data:')) result[key]=externalize(v,[...path,key]);
    if(typeof item.data==='string' && item.data.startsWith('data:')) {
      const file=decodeFile(item.data);
      objects.set(file.id,file);
      result.fileId=file.id;result.size=file.size;result.mime=file.mime;
      references.push({path:path.join('/'),fileId:file.id,size:file.size,mime:file.mime});
    }
    return result;
  };
  const compact=externalize(cleaned);
  const app={}, quarantine={}, access={}, userReport=[];
  for(const [key,v] of Object.entries(compact)) {
    if(key==='usuarios' || key==='uidIndex') continue;
    if(APP_NODES.includes(key)) app[key]=v; else quarantine[key]=v;
  }
  app.usuarios={};
  quarantine.usuarios={};
  quarantine.uidIndex=compact.uidIndex || {};
  if(app.config?.emailjs) {
    quarantine.config={emailjs:app.config.emailjs};delete app.config.emailjs;
  }
  for(const [id,original] of Object.entries(compact.usuarios || {})) {
    const email=String(original.email || '').trim().toLowerCase();
    const oldRoles=Array.isArray(original.roles) ? original.roles : [original.rol];
    const corporate=DOMAINS.includes(email.split('@')[1]);
    const employee=oldRoles.some(r=>ROLES.includes(r));
    if(!corporate || !employee) {quarantine.usuarios[id]=original;continue;}
    const roles=admins.has(email) ? [...new Set(['director',...oldRoles.filter(r=>ROLES.includes(r))])] : oldRoles.filter(r=>ROLES.includes(r) && r!=='director');
    const active=roles.length>0;
    const user=validateUser({nombre:original.nombre,email,roles:active?roles:['profesor'],grupos:original.grupos || [],materias:original.materias || [],activo:active},id);
    if(access[emailKey(email)]) throw new Error('Hay emails corporativos duplicados en el export.');
    app.usuarios[id]=user;access[emailKey(email)]=id;
    userReport.push({id,email,active,roles:user.roles});
    if(oldRoles.includes('director') && !admins.has(email)) {
      quarantine.usuarios[id]=original;
      userReport.at(-1).review='Se retiró el rol director: los administradores autorizados son los indicados en la migración.';
    }
  }
  for(const email of admins) {
    if(access[emailKey(email)]) continue;
    const id='uadmin-'+emailKey(email).slice(0,16);
    const user=validateUser({nombre:email.split('@')[0],email,roles:['director'],grupos:[],materias:[],activo:true},id);
    app.usuarios[id]=user;access[emailKey(email)]=id;userReport.push({id,email,active:true,roles:user.roles,created:true});
  }
  // Preserve malformed/orphan data separately instead of assigning it to an invented pupil.
  quarantine.orphans={};
  for(const node of ['tareas','faltas','notas','notasRA','disciplina','observaciones','matriculas','pendientes','autorizaciones','historico','convalidaciones']) {
    for(const [id,v] of Object.entries(app[node] || {})) if(!app.alumnos?.[id]) {
      quarantine.orphans[node] ||= {};quarantine.orphans[node][id]=v;delete app[node][id];
    }
  }
  for(const [id,record] of Object.entries(app.auditoria || {})) app.auditoria[id]={...record,origen:'importada'};
  for(const [id,al] of Object.entries(app.alumnos || {})) if(al.id!==id || !al.nombre || !al.apellidos || !(app.grupos || []).includes(al.grupo)) throw new Error('Hay alumnado sin identidad o grupo válido.');
  const missingTeachers=[];
  for(const [group,assignment] of Object.entries(app.asignaciones || {})) for(const [module,id] of Object.entries(assignment.profesores || {})) {
    if(id && !app.usuarios[id]) missingTeachers.push({group,module,userId:id});
  }
  if(missingTeachers.length) throw new Error('Hay asignaciones de profesorado sin perfil corporativo. Revisa el informe original.');
  validateData(app);
  const files=Object.fromEntries([...objects.values()].map(f=>[f.id,{object:'files/'+f.id,sha256:f.id,size:f.size}]));
  const root={app,access,files,migrationQuarantine:quarantine,migration:{sourceSha256,version:1,preparedAt:new Date().toISOString()}};
  const allReferences=fileReferences(root);
  if(allReferences.length!==references.length || allReferences.some(f=>!files[f.fileId])) throw new Error('No se han conservado todas las referencias a archivos.');
  const sourceTaskCount=Object.values(source.tareas || {}).reduce((n,v)=>n+Object.keys(v).length,0);
  const targetTaskCount=Object.values(app.tareas || {}).reduce((n,v)=>n+Object.keys(v).length,0);
  const orphanTaskCount=Object.values(quarantine.orphans.tareas || {}).reduce((n,v)=>n+Object.keys(v).length,0);
  if(sourceTaskCount!==targetTaskCount+orphanTaskCount) throw new Error('No coinciden los recuentos de tareas.');
  const report={sourceSha256,credentialsRemoved:credentials.removed,students:Object.keys(app.alumnos || {}).length,sourceTasks:sourceTaskCount,tasks:targetTaskCount,quarantinedTasks:orphanTaskCount,sourceUsers:Object.keys(source.usuarios || {}).length,users:userReport,quarantinedUsers:Object.keys(quarantine.usuarios).length,attachments:references.length,uniqueFiles:objects.size,decodedBytes:[...objects.values()].reduce((n,f)=>n+f.size,0),metadataBytes:Buffer.byteLength(JSON.stringify(root)),references};
  if(report.metadataBytes>8*1024*1024) throw new Error('Los metadatos aún superan el tamaño seguro de esta versión.');
  return {root,objects,report};
}
export const hash = bytes=>createHash('sha256').update(bytes).digest('hex');
// Firebase drops null/empty containers and may return numeric-key objects as arrays.
// Compare logical paths, not object insertion order or the SDK's array representation.
export function canonicalFirebase(value) {
  if(value===null || value===undefined) return undefined;
  if(typeof value!=='object') return value;
  const out={};
  for(const key of Object.keys(value).sort()) {
    const child=canonicalFirebase(value[key]);
    if(child!==undefined) out[key]=child;
  }
  return Object.keys(out).length ? out : undefined;
}
export const firebaseHash = value=>hash(Buffer.from(JSON.stringify(canonicalFirebase(value)) || 'null'));
