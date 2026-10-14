import { createHash } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import { at, dataView, fail, isDirector, pathParts } from './policy.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ID = /^[a-f0-9]{64}$/;
export function decodeFile(data, maxBytes = MAX_FILE_BYTES) {
  if (typeof data !== 'string' || data.length > Math.ceil(maxBytes/3)*4+300) fail(400,'El archivo supera el tamaño permitido.');
  const match=/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(data);
  if (!match) fail(400,'Archivo Base64 inválido.');
  const bytes=Buffer.from(match[2],'base64');
  if (!bytes.length || bytes.length>maxBytes || bytes.toString('base64')!==match[2]) fail(400,'Archivo Base64 inválido o demasiado grande.');
  const id=createHash('sha256').update(bytes).digest('hex');
  return {id,bytes,size:bytes.length,mime:match[1].toLowerCase()};
}
export function fileReferences(value, output=[]) {
  if(!value || typeof value!=='object') return output;
  if('fileId' in value) {
    if(!ID.test(value.fileId)) fail(400,'Referencia de archivo inválida.');
    output.push(value);
  }
  for(const item of Object.values(value)) if(item && typeof item==='object') fileReferences(item,output);
  return output;
}
export function prepareFiles(value) {
  const objects=new Map();
  const walk=item => {
    if(!item || typeof item!=='object') return item;
    if(Array.isArray(item)) return item.map(walk);
    const result={};
    if(Object.keys(item).some(k=>['__proto__','constructor','prototype'].includes(k))) fail(400,'Campo no permitido.');
    for(const [key,v] of Object.entries(item)) result[key]=walk(v);
    if(typeof item.data==='string' && item.data.startsWith('data:')) {
      const file=decodeFile(item.data);objects.set(file.id,file);
      delete result.data;result.fileId=file.id;result.mime=file.mime;result.size=file.size;
    }
    return result;
  };
  return {value:walk(value),objects};
}
export function assertFileReferences(user, root, incoming, uploaded) {
  const known=new Set(fileReferences(dataView(user,root.app || {})).map(f=>f.fileId));
  for(const file of fileReferences(incoming)) {
    if(!uploaded.has(file.fileId) && ((!isDirector(user) && !known.has(file.fileId)) || !root.files?.[file.fileId])) fail(403,'No tienes acceso a ese archivo.');
    const size=uploaded.get(file.fileId)?.size ?? root.files[file.fileId].size;
    if(file.size!==size) fail(400,'Tamaño de archivo no válido.');
  }
}
export function authorizedFile(user, root, path, quarantine=false) {
  const parts=pathParts(path);
  if(!parts.length) fail(400,'Indica el documento que quieres descargar.');
  if(quarantine && !isDirector(user)) fail(403,'Solo dirección puede revisar archivos en cuarentena.');
  const document=at(quarantine ? root.migrationQuarantine : dataView(user,root.app || {}),parts);
  if(!document?.fileId || !ID.test(document.fileId)) fail(404,'Archivo no disponible.');
  const stored=root.files?.[document.fileId];
  if(!stored || stored.object!==`files/${document.fileId}` || stored.sha256!==document.fileId) fail(404,'Archivo no disponible.');
  return {id:document.fileId,name:String(document.nombre || 'archivo').replace(/[/\\\r\n\x00-\x1f\x7f]/g,'_'),...stored};
}
export function createFileStore({projectId,bucketName}) {
  if(!bucketName || !bucketName.startsWith(projectId+'-')) throw new Error('ATTACHMENTS_BUCKET debe pertenecer al proyecto configurado.');
  const bucket=new Storage({projectId}).bucket(bucketName);
  return {
    async ensurePrivate() {
      const [metadata]=await bucket.getMetadata();
      if(!metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled || metadata.iamConfiguration?.publicAccessPrevention!=='enforced') throw new Error('El bucket debe tener acceso uniforme y prevención de acceso público.');
      const [policy]=await bucket.iam.getPolicy();
      if(policy.bindings?.some(b=>b.members?.some(m=>['allUsers','allAuthenticatedUsers'].includes(m)))) throw new Error('El bucket tiene permisos públicos.');
    },
    async save(file) {
      if(!ID.test(file.id) || createHash('sha256').update(file.bytes).digest('hex')!==file.id) throw new Error('El contenido no coincide con su hash.');
      const object=bucket.file('files/'+file.id);
      try {
        const [existing]=await object.getMetadata();
        if(existing.metadata?.sha256!==file.id || Number(existing.size)!==file.size) throw new Error('El objeto existente no coincide con el archivo.');
        return {object:'files/'+file.id,sha256:file.id,size:file.size};
      } catch(error) {if(Number(error.code)!==404) throw error;}
      try {
        await object.save(file.bytes,{resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/octet-stream',cacheControl:'private, no-store',metadata:{sha256:file.id}}});
      } catch(error) {
        if(Number(error.code)!==412) throw error;
        const [metadata]=await object.getMetadata();
        if(metadata.metadata?.sha256!==file.id || Number(metadata.size)!==file.size) throw new Error('El objeto existente no coincide con el archivo.');
      }
      return {object:'files/'+file.id,sha256:file.id,size:file.size};
    },
    stream(id) {
      if(!ID.test(id)) throw new Error('ID de archivo inválido.');
      return bucket.file('files/'+id).createReadStream({validation:'crc32c'});
    }
  };
}
