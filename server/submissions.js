import {randomUUID} from 'node:crypto';
import {fail,pathParts} from './policy.js';
import {decodeFile} from './files.js';
export function assertSubmission(user,root,alumnoId,tareaId,now=Date.now()) {
  if(user.roles?.length!==1||user.roles[0]!=='alumno'||!user.alumnosIds?.includes(alumnoId))fail(403,'Solo puedes entregar tus propias tareas.');
  for(const id of [alumnoId,tareaId])if(typeof id!=='string'||pathParts(id).length!==1)fail(400,'Tarea inválida.');
  if(!Object.hasOwn(root.app?.alumnos||{},alumnoId)||!Object.hasOwn(root.app?.tareas?.[alumnoId]||{},tareaId))fail(404,'Tarea no disponible.');
  const task=root.app.tareas[alumnoId][tareaId];
  if(task.fecha){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(task.fecha)||!Number.isFinite(Date.parse(task.fecha))||new Date(task.fecha).toISOString().slice(0,10)!==task.fecha)fail(403,'La fecha de entrega no es válida. Consulta con tu profesor.');
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    if(today>task.fecha)fail(403,'La fecha de entrega ha vencido: plazo cerrado.');
  }
  return task;
}
export function mountSubmissions({app,transaction,fileStore}) {
  app.post('/api/submissions',async(req,res)=>{
    const body=req.body||{};
    if(Object.keys(body).some(k=>!['alumnoId','tareaId','action','file'].includes(k))||!['upload','delete'].includes(body.action))fail(400,'Entrega inválida.');
    const {alumnoId,tareaId,action}=body;
    assertSubmission(req.user,req.root,alumnoId,tareaId);
    let file,registration,name;
    if(action==='upload'){
      if(!body.file||Object.keys(body.file).some(k=>!['nombre','data'].includes(k)))fail(400,'Archivo inválido.');
      name=body.file.nombre;
      if(typeof name!=='string'||!name.trim()||name.length>200||/[<>/\\\x00-\x1f\x7f]/.test(name))fail(400,'Nombre de archivo inválido.');
      file=decodeFile(body.file.data);
      if(!fileStore)fail(503,'El almacenamiento de archivos no está configurado.');
      registration=await fileStore.save(file);
    }else if(body.file!==undefined)fail(400,'No se admite archivo al retirar una entrega.');
    await transaction(req,(root,user)=>{
      const task=assertSubmission(user,root,alumnoId,tareaId),now=Date.now();
      if(action==='upload'){
        root.files||={};root.files[file.id]=registration;
        task.archivoAlumno={nombre:name,fileId:file.id,size:file.size,mime:file.mime,ts:now,fecha:new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid'}).format(now)};
        task.estado='Entregada';task.entregaAuto=true;task.entregaFecha=new Date(now).toISOString();
      }else{
        delete task.archivoAlumno;
        if(task.entregaAuto){task.estado='Pendiente';delete task.entregaAuto;delete task.entregaFecha;}
      }
      root.app.auditoria||={};root.app.auditoria[randomUUID()]={ts:now,userId:user.id,userNombre:user.nombre,tipo:'Entrega de tarea',detalle:`${action==='upload'?'Entrega':'Retirada'}: ${alumnoId}/${tareaId}`};
      return root;
    });
    res.json({ok:true});
  });
}
