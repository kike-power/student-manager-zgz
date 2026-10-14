import { readFile, writeFile, mkdir, stat, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { prepareMigration, hash, firebaseHash } from './migration-lib.js';
import { createStore } from '../server/store.js';
import { createFileStore } from '../server/files.js';

const args=process.argv.slice(2),command=args.shift();
const options={};
for(let i=0;i<args.length;i++) {
  const match=/^--([a-z]+)(?:=(.*))?$/.exec(args[i]);
  const value=match?.[2] ?? args[++i];
  if(!match || !['source','output','stage','admins','project'].includes(match[1]) || !value || value.startsWith('--') || match[1] in options) throw new Error('Usa opciones --nombre valor o --nombre=valor, sin duplicados.');
  options[match[1]]=value;
}
const stage=path.resolve(options.output || options.stage || '.review/migration');
const cwd=process.cwd();
if(stage===cwd || (stage.startsWith(cwd+path.sep) && !stage.startsWith(path.join(cwd,'.review')+path.sep))) throw new Error('Guarda los datos privados dentro de .review/ o fuera del repositorio.');
async function privateWrite(file,value) {await writeFile(file,value,{mode:0o600});await chmod(file,0o600);}
if(command==='prepare') {
  if(!options.source || !options.admins) throw new Error('Indica --source export.zip --admins email1,email2.');
  const bytes=await readFile(options.source);
  let text;
  if(options.source.toLowerCase().endsWith('.zip')) {
    const script="import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); items=[i for i in z.infolist() if not i.is_dir()]; assert len(items)==1 and items[0].filename.lower().endswith('.json') and items[0].file_size<256*1024*1024, 'ZIP no válido'; sys.stdout.buffer.write(z.read(items[0]))";
    text=execFileSync(process.env.PYTHON_BINARY || 'python3',['-c',script,options.source],{maxBuffer:256*1024*1024}).toString('utf8');
  } else text=bytes.toString('utf8');
  const prepared=prepareMigration(JSON.parse(text),{sourceSha256:hash(bytes),adminEmails:options.admins.split(',')});
  await mkdir(stage,{recursive:true,mode:0o700});await chmod(stage,0o700);
  await mkdir(path.join(stage,'objects'),{recursive:true,mode:0o700});
  for(const f of prepared.objects.values()) await privateWrite(path.join(stage,'objects',f.id),f.bytes);
  await privateWrite(path.join(stage,'database.json'),JSON.stringify(prepared.root));
  await privateWrite(path.join(stage,'report.json'),JSON.stringify(prepared.report,null,2));
  const databaseSha256=hash(await readFile(path.join(stage,'database.json')));
  await privateWrite(path.join(stage,'manifest.json'),JSON.stringify({sourceSha256:prepared.report.sourceSha256,databaseSha256,files:Object.keys(prepared.root.files)},null,2));
  console.log(JSON.stringify({students:prepared.report.students,tasks:prepared.report.tasks,quarantinedTasks:prepared.report.quarantinedTasks,attachments:prepared.report.attachments,uniqueFiles:prepared.report.uniqueFiles,metadataBytes:prepared.report.metadataBytes,credentialsRemoved:prepared.report.credentialsRemoved,stage},null,2));
} else if(command==='apply' || command==='upload') {
  const projectId=process.env.GOOGLE_CLOUD_PROJECT;
  if(!projectId || options.project!==projectId) throw new Error('Confirma el destino con --project igual a GOOGLE_CLOUD_PROJECT.');
  const manifest=JSON.parse(await readFile(path.join(stage,'manifest.json'),'utf8'));
  const databaseBytes=await readFile(path.join(stage,'database.json'));
  if(hash(databaseBytes)!==manifest.databaseSha256) throw new Error('La base preparada ha cambiado desde la verificación.');
  const root=JSON.parse(databaseBytes);
  const fileStore=createFileStore({projectId,bucketName:process.env.ATTACHMENTS_BUCKET});
  const store=command==='apply' ? createStore({projectId,databaseURL:process.env.FIREBASE_DATABASE_URL}) : null;
  if(store) {
    const existing=await store.read();
    if(existing.migration?.sourceSha256===manifest.sourceSha256) {console.log('Esta migración ya está importada.');process.exit(0);}
    if(Object.keys(existing).length) throw new Error('El destino ya contiene datos. No se sobrescribirá.');
  }
  await fileStore.ensurePrivate();
  let uploaded=0;
  for(const id of manifest.files) {
    const bytes=await readFile(path.join(stage,'objects',id));
    if(hash(bytes)!==id || bytes.length!==root.files[id]?.size) throw new Error('Archivo corrupto en la preparación local.');
    await fileStore.save({id,bytes,size:bytes.length});uploaded++;
    if(uploaded%25===0) console.log(`Archivos verificados/subidos: ${uploaded}/${manifest.files.length}`);
  }
  await privateWrite(path.join(stage,'upload-receipt.json'),JSON.stringify({projectId,bucket:process.env.ATTACHMENTS_BUCKET,sourceSha256:manifest.sourceSha256,files:uploaded,uploadedAt:new Date().toISOString()},null,2));
  if(command==='upload') {console.log(`Archivos subidos/verificados: ${uploaded}. Aún no se ha importado la base de datos.`);process.exit(0);}
  const result=await store.transaction(current=>{
    if(current.migration?.sourceSha256===manifest.sourceSha256) return current;
    if(Object.keys(current).length) throw new Error('El destino dejó de estar vacío durante la importación.');
    return {...root,migration:{...root.migration,appliedAt:new Date().toISOString()}};
  });
  if(result.migration.sourceSha256!==manifest.sourceSha256 || firebaseHash(result.app)!==firebaseHash(root.app) || firebaseHash(result.files)!==firebaseHash(root.files) || firebaseHash(result.migrationQuarantine)!==firebaseHash(root.migrationQuarantine)) throw new Error('La verificación después de importar no coincide.');
  console.log('Migración aplicada y verificada. No se ha modificado la base original.');
  process.exit(0);
} else throw new Error('Usa migrate.js prepare, upload o apply.');
