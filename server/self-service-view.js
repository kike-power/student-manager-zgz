// Explicit allowlist: adding staff data never exposes it to students or families.
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,structuredClone(value[k])]));
const safeKey=value=>String(value).replace(/[.#$/\[\]]/g,'_');
export function selfServiceView(user,root,now=Date.now()) {
  const ids=(user.alumnosIds||[]).filter(id=>Object.hasOwn(root.alumnos||{},id)),groups=[...new Set(ids.map(id=>root.alumnos[id].grupo))];
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const published=eva=>{const date=root.config?.evaluaciones?.[eva]?.publicacion;return !!date&&date<=today;};
  const out={config:pick(root.config,['schoolName','curso','logo']),usuarios:{[user.id]:pick(user,['id','nombre','email','roles','alumnosIds','activo'])},grupos:groups,asignaturas:[],asignaciones:{},alumnos:{},faltas:{},tareas:{},notas:{},notasRA:{},rubricas:{cfg:{},val:{},ajuste:{}},avisos:{},salidas:{},moduloCodigos:{},moduloRAs:{}};
  out.config.evaluaciones={};for(const eva of [1,2,3])out.config.evaluaciones[eva]={publicacion:root.config?.evaluaciones?.[eva]?.publicacion||''};
  const teacherIds=new Set();
  for(const group of groups){const assignment=root.asignaciones?.[safeKey(group)]||{};const modules=assignment.asignaturas||root.asignaturas||[];out.asignaciones[safeKey(group)]={asignaturas:modules,profesores:assignment.profesores||{}};out.asignaturas.push(...modules);for(const id of Object.values(assignment.profesores||{}))teacherIds.add(id);}
  out.asignaturas=[...new Set(out.asignaturas)];
  for(const [id,u]of Object.entries(root.usuarios||{}))if(teacherIds.has(id)||(u.roles?.includes('tutor')&&(u.grupos||[]).some(g=>groups.includes(g))))out.usuarios[id]=pick(u,['id','nombre','roles','grupos']);
  for(const id of ids){
    out.alumnos[id]=pick(root.alumnos[id],['id','nombre','apellidos','grupo','estado','docs']);
    out.faltas[id]=structuredClone(root.faltas?.[id]||{});
    out.tareas[id]=Object.fromEntries(Object.entries(root.tareas?.[id]||{}).map(([key,task])=>[key,pick(task,['id','materia','desc','fecha','fechaLimite','estado','cal','obs','archivoProf','archivoAlumno','entregaFecha'])]));
    for(const node of ['notas','notasRA'])out[node][id]=Object.fromEntries(Object.entries(root[node]?.[id]||{}).filter(([eva])=>published(eva)).map(([eva,value])=>[eva,structuredClone(value)]));
    for(const section of ['val','ajuste'])out.rubricas[section][id]=Object.fromEntries(Object.entries(root.rubricas?.[section]?.[id]||{}).filter(([eva])=>published(eva)).map(([eva,value])=>[eva,structuredClone(value)]));
  }
  for(const module of out.asignaturas){const key=safeKey(module);for(const node of ['moduloCodigos','moduloRAs'])if(root[node]?.[key]!==undefined)out[node][key]=structuredClone(root[node][key]);if(root.rubricas?.cfg?.[key])out.rubricas.cfg[key]=structuredClone(root.rubricas.cfg[key]);}
  for(const [id,notice]of Object.entries(root.avisos||{}))if([undefined,'todos','familias',true].includes(notice.publico))out.avisos[id]=pick(notice,['id','titulo','cuerpo','fecha','ts','autor','publico']);
  for(const [id,event]of Object.entries(root.salidas||{}))out.salidas[id]=pick(event,['id','evento','desde','hasta','dia','domicilio']);
  return out;
}
