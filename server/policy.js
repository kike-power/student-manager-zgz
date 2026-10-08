import { createHash } from 'node:crypto';

export const DOMAINS = Object.freeze(['thepower.education', 'ext.thepower.education', 'prometeo-fp.com']);
export const ROLES = Object.freeze(['director', 'tutor', 'profesor']);
export const APP_NODES = Object.freeze(['config', 'usuarios', 'grupos', 'grupoSiguiente', 'archivoCursos', 'asignaturas', 'asignaciones', 'alumnos', 'faltas', 'tareas', 'notas', 'disciplina', 'empresas', 'fctAsignaciones', 'horario', 'calendario', 'salidas', 'observaciones', 'pendientes', 'matriculas', 'oferta', 'actas', 'moduloCodigos', 'moduloRAs', 'notasRA', 'rubricas', 'autorizaciones', 'historico', 'convalidaciones', 'avisos', 'auditoria', 'guardias']);
const STUDENT_NODES = ['alumnos', 'faltas', 'tareas', 'notas', 'disciplina', 'observaciones', 'pendientes', 'matriculas', 'notasRA', 'autorizaciones', 'historico', 'convalidaciones'];
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };
export const emailKey = email => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
export const sessionKey = token => createHash('sha256').update(token).digest('hex');
export const safeKey = str => String(str).replace(/[.#$/\[\]]/g, '_');
export const isDirector = user => user?.roles?.includes('director') === true;

export function corporateEmail(value) {
  if (typeof value !== 'string') fail(400, 'Email corporativo obligatorio.');
  const email = value.trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9.-]+$/.test(email) || !DOMAINS.includes(email.split('@')[1])) fail(403, 'El dominio del email no está autorizado.');
  return email;
}
export function verifyCorporateClaims(claims) {
  if (!claims?.sub || claims.email_verified !== true || !DOMAINS.includes(claims.hd)) fail(403, 'Usa una cuenta de Google Workspace autorizada.');
  return { email: corporateEmail(claims.email), sub: claims.sub, hd: claims.hd };
}
export function pathParts(path) {
  if (typeof path !== 'string' || path.length > 1500) fail(400, 'Ruta inválida.');
  const parts = path === '' || path === '/' ? [] : path.replace(/^\//, '').split('/');
  if (parts.some(p => !p || /[.#$\[\]\x00-\x1f\x7f]/.test(p) || ['__proto__', 'prototype', 'constructor'].includes(p))) fail(400, 'Ruta inválida.');
  return parts;
}
export const at = (root, parts) => parts.reduce((v, p) => v?.[p], root);
export function put(root, parts, value) {
  if (!parts.length) fail(400, 'No se permite sustituir toda la base de datos.');
  let node = root;
  for (const p of parts.slice(0, -1)) {
    if (!node[p] || typeof node[p] !== 'object') node[p] = {};
    node = node[p];
  }
  if (value === null) delete node[parts.at(-1)]; else node[parts.at(-1)] = value;
}
export function publicUser(user) {
  const { id, nombre, email, roles, grupos, materias, activo } = user;
  return { id, nombre, email, roles, rol: roles?.[0], rolesMap: Object.fromEntries((roles || []).map(r => [r, true])), grupos: grupos || [], materias: materias || [], activo: activo === true };
}
export function validateUser(body, id) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Usuario inválido.');
  const allowed = ['nombre', 'email', 'roles', 'grupos', 'materias', 'activo'];
  if (Object.keys(body).some(k => !allowed.includes(k))) fail(400, 'Campo de usuario no permitido.');
  const email = corporateEmail(body.email);
  if (typeof body.nombre !== 'string' || !body.nombre.trim() || body.nombre.length > 150 || /[<>\x00-\x1f]/.test(body.nombre)) fail(400, 'Nombre inválido.');
  if (!Array.isArray(body.roles) || !body.roles.length || body.roles.some(r => !ROLES.includes(r))) fail(400, 'Solo se admiten roles de empleados.');
  if (typeof body.activo !== 'boolean') fail(400, 'Indica si el usuario está activo.');
  const list = key => {
    const values = body[key] || [];
    if (!Array.isArray(values) || values.length > 100 || values.some(v => typeof v !== 'string' || v.length > 150 || /[<>\x00-\x1f]/.test(v))) fail(400, 'Asignaciones inválidas.');
    return [...new Set(values)];
  };
  return { id, nombre: body.nombre.trim(), email, roles: [...new Set(body.roles)], grupos: list('grupos'), materias: list('materias'), activo: body.activo };
}
export function validateData(value, depth = 0) {
  if (depth > 20) fail(400, 'Datos demasiado anidados.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail(400, 'Número inválido.'); return; }
  if (typeof value === 'string') {
    // Keep legacy text rendering safe while the UI is gradually split into components.
    if (/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail(400, 'El texto no admite etiquetas HTML.');
    if (value.startsWith('data:')) {
      if (!/^data:(application\/(pdf|zip|msword|vnd\.[a-z0-9.+-]+)|image\/(jpeg|png|gif|webp));base64,[A-Za-z0-9+/=]+$/.test(value) || value.length > 7_000_000) fail(400, 'Formato o tamaño de archivo no permitido.');
    } else if (value.length > 20_000) fail(400, 'Texto demasiado largo.');
    return;
  }
  if (!value || typeof value !== 'object') fail(400, 'Datos inválidos.');
  for (const [key, item] of Object.entries(value)) {
    pathParts(key);
    if (key.includes('/') || ['pass', 'password', 'uidIndex', '__security', '.sv'].includes(key)) fail(400, 'Campo no permitido.');
    validateData(item, depth + 1);
  }
}
export function groupsFor(user, root) {
  if (isDirector(user)) return new Set(root.grupos || []);
  const groups = new Set(user.roles.includes('tutor') ? user.grupos || [] : []);
  if (user.roles.includes('profesor')) for (const [gk, assignment] of Object.entries(root.asignaciones || {})) {
    if (Object.values(assignment.profesores || {}).includes(user.id)) {
      const group = (root.grupos || []).find(g => safeKey(g) === gk);
      if (group) groups.add(group);
    }
  }
  return groups;
}
function tutorsGroup(user, group) { return user.roles.includes('tutor') && (user.grupos || []).includes(group); }
function moduleAllowed(user, root, group, module) {
  if (isDirector(user) || tutorsGroup(user, group)) return true;
  return user.roles.includes('profesor') && root.asignaciones?.[safeKey(group)]?.profesores?.[safeKey(module)] === user.id;
}
function pickModules(user, root, group, modules) {
  return Object.fromEntries(Object.entries(modules || {}).filter(([mk]) => moduleAllowed(user, root, group, mk)));
}
function sessionModule(root, group, key) {
  const prefix = /^\d{4}-\d{2}-\d{2}_/.exec(key);
  if (!prefix) return null;
  const rest = key.slice(prefix[0].length), groupPrefix = safeKey(group) + '_';
  if (!rest.startsWith(groupPrefix)) return null;
  const tail = rest.slice(groupPrefix.length);
  return [...(root.asignaciones?.[safeKey(group)]?.asignaturas || root.asignaturas || [])].sort((a,b) => b.length-a.length).find(m => tail === safeKey(m) || tail.startsWith(safeKey(m) + '_')) || null;
}
export function dataView(user, root) {
  const out = Object.fromEntries(APP_NODES.filter(n => n in root).map(n => [n, structuredClone(root[n])]));
  out.usuarios = Object.fromEntries(Object.entries(root.usuarios || {}).map(([id,u]) => [id, isDirector(user) || id === user.id ? publicUser(u) : { id, nombre:u.nombre, roles:u.roles || [], rol:u.roles?.[0], grupos:u.grupos || [], materias:u.materias || [] }]));
  if (isDirector(user)) return out;
  const groups = groupsFor(user, root);
  const students = Object.fromEntries(Object.entries(root.alumnos || {}).filter(([,a]) => groups.has(a.grupo)));
  out.grupos = [...groups];
  // Configuration secrets and administration-only data never reach teaching accounts.
  const cfg = root.config || {};
  out.config = Object.fromEntries(['schoolName','curso','tramos','evaluaciones','logo'].filter(k => k in cfg).map(k => [k,cfg[k]]));
  for (const key of ['auditoria','archivoCursos','grupoSiguiente','actas','oferta','guardias']) delete out[key];
  for (const key of STUDENT_NODES) out[key] = Object.fromEntries(Object.keys(students).filter(id => root[key]?.[id] !== undefined).map(id => [id, structuredClone(root[key][id])]));
  for (const [id, al] of Object.entries(students)) {
    const tutor = tutorsGroup(user, al.grupo);
    if (!tutor) {
      out.alumnos[id] = Object.fromEntries(['id','nombre','apellidos','grupo','estado','expediente'].filter(k => k in al).map(k => [k,al[k]]));
      for (const n of ['disciplina','observaciones','pendientes','matriculas','autorizaciones','historico','convalidaciones']) delete out[n][id];
    }
    for (const n of ['notas','notasRA']) out[n][id] = Object.fromEntries(Object.entries(root[n]?.[id] || {}).map(([eva,modules]) => [eva,pickModules(user,root,al.grupo,modules)]));
    out.tareas[id] = Object.fromEntries(Object.entries(root.tareas?.[id] || {}).filter(([,t]) => moduleAllowed(user,root,al.grupo,t.materia)));
    if (!tutor) out.faltas[id] = {
      asig: pickModules(user,root,al.grupo,root.faltas?.[id]?.asig),
      sesiones: Object.fromEntries(Object.entries(root.faltas?.[id]?.sesiones || {}).filter(([k]) => { const m=sessionModule(root,al.grupo,k); return m && moduleAllowed(user,root,al.grupo,m); }))
    };
  }
  out.asignaciones = Object.fromEntries(Object.entries(root.asignaciones || {}).filter(([g]) => [...groups].some(name => safeKey(name) === g)).map(([g,a]) => {
    const name=[...groups].find(n=>safeKey(n)===g);
    return [g,{...a,asignaturas:(a.asignaturas || root.asignaturas || []).filter(m=>moduleAllowed(user,root,name,m))}];
  }));
  out.horario = Object.fromEntries(Object.entries(root.horario || {}).filter(([,h]) => groups.has(h.grupo)));
  out.fctAsignaciones = Object.fromEntries(Object.entries(root.fctAsignaciones || {}).filter(([,f]) => (f.alumnos || [f.alumnoId]).length && (f.alumnos || [f.alumnoId]).every(id => students[id] && tutorsGroup(user, students[id].grupo))));
  const empresaIds = new Set(Object.values(out.fctAsignaciones).map(f => f.empId));
  out.empresas = Object.fromEntries(Object.entries(root.empresas || {}).filter(([id]) => empresaIds.has(id)));
  out.rubricas = { cfg: {}, val:{}, ajuste:{} };
  for (const [mk,v] of Object.entries(root.rubricas?.cfg || {})) if ([...groups].some(g => moduleAllowed(user,root,g,mk))) out.rubricas.cfg[mk] = v;
  for (const n of ['val','ajuste']) for (const [id,al] of Object.entries(students)) out.rubricas[n][id] = Object.fromEntries(Object.entries(root.rubricas?.[n]?.[id] || {}).map(([eva,m]) => [eva,pickModules(user,root,al.grupo,m)]));
  return out;
}

export function assertWrite(user, root, next, parts) {
  const [node, aid, p2, p3] = parts;
  if (!APP_NODES.includes(node) || ['usuarios','auditoria'].includes(node)) fail(403, 'Usa la gestión de usuarios o la auditoría del servidor.');
  if (isDirector(user)) return;
  if (node === 'fctAsignaciones') {
    const old=root.fctAsignaciones?.[aid], proposed=next.fctAsignaciones?.[aid];
    const scoped=f=>f && (f.alumnos || []).length && f.alumnos.every(id=>root.alumnos?.[id] && tutorsGroup(user,root.alumnos[id].grupo));
    if (!aid || (!old && !proposed) || (old && !scoped(old)) || (proposed && !scoped(proposed))) fail(403,'Sin permiso para esta asignación FCT.');
    return;
  }
  if (node === 'rubricas') {
    const [,section,id,eva,mk] = parts, al=root.alumnos?.[id];
    if (!['val','ajuste'].includes(section) || !al || !mk || !moduleAllowed(user,root,al.grupo,mk)) fail(403,'Sin permiso para esta rúbrica.');
    assertEvaluation(root,eva); return;
  }
  const al = root.alumnos?.[aid];
  if (!STUDENT_NODES.includes(node) || !al || !groupsFor(user, root).has(al.grupo)) fail(403, 'Sin permiso para este recurso.');
  if (['notas','notasRA'].includes(node)) {
    if (parts.length < 4 || !moduleAllowed(user,root,al.grupo,p3)) fail(403,'Sin permiso para este módulo.');
    assertEvaluation(root,p2); return;
  }
  if (node === 'tareas') {
    const task = root.tareas?.[aid]?.[p2], newTask = next.tareas?.[aid]?.[p2];
    if (!p2 || (!task && !newTask) || (task && !moduleAllowed(user,root,al.grupo,task.materia)) || (newTask && !moduleAllowed(user,root,al.grupo,newTask.materia))) fail(403,'Sin permiso para esta tarea.');
    return;
  }
  if (node === 'faltas' && !tutorsGroup(user,al.grupo)) {
    const module = p2 === 'asig' ? p3 : p2 === 'sesiones' && p3 ? sessionModule(root,al.grupo,p3) : null;
    if (!module || !moduleAllowed(user,root,al.grupo,module) || parts.length !== 4) fail(403,'Sin permiso para esta asistencia.');
    return;
  }
  if (!tutorsGroup(user,al.grupo)) fail(403,'Esta operación requiere tutoría o dirección.');
  if (node === 'alumnos') {
    if (parts.length < 3 || ['id','grupo','estado','dni','ss','expediente'].includes(p2)) fail(403,'La administración de alumnado corresponde a dirección.');
  }
}
function assertEvaluation(root, eva) {
  const opening = root.config?.evaluaciones?.[eva]?.apertura;
  if (opening && new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Madrid'}) < opening) fail(403,'Esta evaluación todavía no está abierta.');
}
export function mutationUpdates(path, op, value) {
  const base = pathParts(path);
  if (!['set','update','remove'].includes(op)) fail(400, 'Operación inválida.');
  const result = {};
  if (op === 'update') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400,'Actualización inválida.');
    for (const [key,v] of Object.entries(value)) {
      const parts = [...base,...pathParts(key)];
      if (!parts.length) fail(400,'Ruta vacía.');
      validateData(v); result[parts.join('/')] = v;
    }
  } else {
    if (!base.length) fail(400,'No se permite sustituir toda la base de datos.');
    validateData(op === 'remove' ? null : value); result[base.join('/')] = op === 'remove' ? null : value;
  }
  const keys = Object.keys(result).sort();
  if (!keys.length || keys.length > 5000) fail(400,'Actualización vacía o demasiado grande.');
  for (let i=1;i<keys.length;i++) if (keys[i].startsWith(keys[i-1]+'/')) fail(400,'Rutas solapadas.');
  return result;
}
// Expand replacements to changed leaves so a parent write cannot bypass field/module checks.
export function changedLeaves(before, after, parts = []) {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!object(before) && !object(after)) return [parts];
  return [...new Set([...Object.keys(object(before) ? before : {}),...Object.keys(object(after) ? after : {})])].flatMap(k => changedLeaves(before?.[k],after?.[k],[...parts,k]));
}
export function validateAcademicChanges(current, next, updates) {
  const grade=value => {
    if (value!==undefined && value!==null && value!=='' && (typeof value!=='number' || value<0 || value>10)) fail(400,'La calificación debe estar entre 0 y 10.');
  };
  for(const [key,value] of Object.entries(updates)) for(const parts of changedLeaves(at(current,pathParts(key)),value,pathParts(key))) {
    const [node,aid,section]=parts, v=at(next,parts);
    if (['notas','notasRA'].includes(node)) grade(v);
    if (node==='tareas' && parts.at(-1)==='cal') grade(v);
    if (node==='faltas' && v!==undefined && v!==null) {
      if (section==='asig') {if(typeof v!=='number' || v<0 || v>100000) fail(400,'Horas de ausencia inválidas.');}
      else if (!['P','A','J','R'].includes(v)) fail(400,'Estado de asistencia inválido.');
    }
    if(node==='alumnos' && next.alumnos?.[aid]) {
      const al=next.alumnos[aid];
      if(al.id!==aid || typeof al.nombre!=='string' || !al.nombre.trim() || typeof al.apellidos!=='string' || !al.apellidos.trim() || !(next.grupos || []).includes(al.grupo)) fail(400,'Alumno inválido: indica nombre, apellidos y un grado configurado.');
    }
  }
}
