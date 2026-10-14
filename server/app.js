import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { APP_NODES, fail, emailKey, corporateEmail, publicUser, validateUser, dataView, isDirector, pathParts, at, put, mutationUpdates, changedLeaves, assertWrite, validateAcademicChanges } from './policy.js';
import { prepareFiles, assertFileReferences, authorizedFile } from './files.js';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
export function resolveUser(root, claims) {
  const id = root.access?.[emailKey(claims.email)];
  const user = root.app?.usuarios?.[id];
  if (!user || user.activo !== true || user.email !== claims.email || !user.roles?.length || user.roles.some(r => !['director','tutor','profesor'].includes(r))) fail(403, 'Tu cuenta no tiene acceso activo. Contacta con un administrador.');
  if (user.googleSub && user.googleSub !== claims.sub) fail(403,'Esta cuenta de Google no coincide con el usuario autorizado.');
  return user;
}
function audit(root, user, action, detail) {
  root.app.auditoria ||= {};
  root.app.auditoria[randomUUID()] = {ts:Date.now(), userId:user.id, userNombre:user.nombre, tipo:action, detalle:detail};
}
export function createApp({ store, fileStore, verifyIdentity, origin, production = true }) {
  if (!origin || (production && new URL(origin).protocol !== 'https:')) throw new Error('PUBLIC_ORIGIN debe ser una URL HTTPS en producción.');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    crossOriginOpenerPolicy: { policy:'same-origin-allow-popups' },
    contentSecurityPolicy: { directives: {
      defaultSrc:["'self'"], scriptSrc:["'self'","'unsafe-inline'"], scriptSrcAttr:["'unsafe-inline'"],
      styleSrc:["'self'","'unsafe-inline'",'https://fonts.googleapis.com'], fontSrc:["'self'",'https://fonts.gstatic.com'],
      imgSrc:["'self'",'data:','blob:'], connectSrc:["'self'"], frameSrc:['blob:'], objectSrc:["'none'"], baseUri:["'none'"], frameAncestors:["'none'"],
      upgradeInsecureRequests: production ? [] : null
    } }
  }));
  app.use((req,res,next) => {res.set('Cache-Control','no-store'); next();});
  app.get('/healthz', (_req,res) => res.json({ok:true}));
  app.use('/api', rateLimit({windowMs:60000, limit:150, standardHeaders:'draft-8',legacyHeaders:false}));
  app.use('/api', async(req,res,next) => {
    try {
      // Custom header + exact origin excludes cross-site form and fetch mutations.
      if (!['GET','HEAD'].includes(req.method) && (req.get('origin') !== origin || req.get('x-requested-with') !== 'student-manager')) fail(403,'Origen de petición no permitido.');
      req.identity = await verifyIdentity(req);
      req.identity.email = corporateEmail(req.identity.email);
      if (!req.identity.sub) fail(401,'Identidad no válida.');
      req.root = await store.read();
      req.user = resolveUser(req.root,req.identity);
      next();
    } catch(error) { next(error); }
  });
  app.use('/api', express.json({limit:'12mb'}));
  const transaction = async(req, action) => store.transaction(root => {
    const user = resolveUser(root, req.identity);
    return action(root, user);
  });
  app.get('/api/session', async(req,res) => {
    // Bind the invitation email to Google's immutable subject on its first use.
    if (!req.user.googleSub) await transaction(req,(root,user) => {user.googleSub=req.identity.sub; audit(root,user,'Acceso','Primer acceso Google SSO'); return root;});
    res.json({user:publicUser(req.user), domains:['thepower.education','ext.thepower.education','prometeo-fp.com']});
  });
  app.get('/api/database', (req,res) => {
    const parts = pathParts(req.query.path || '/');
    if (parts.length && !APP_NODES.includes(parts[0])) fail(403,'Recurso no permitido.');
    const view = dataView(req.user,req.root.app || {});
    res.json({value:at(view,parts) ?? null});
  });
  app.post('/api/database', async(req,res) => {
    const {path:writePath,op,value} = req.body || {};
    const prepared=prepareFiles(value);
    const updates = mutationUpdates(writePath,op,prepared.value);
    const apply=(root,user,registrations={}) => {
      const current = root.app || {}, next = structuredClone(current);
      for (const [key,v] of Object.entries(updates)) put(next,pathParts(key),v);
      for (const [key,v] of Object.entries(updates)) {
        const parts = pathParts(key);
        assertWrite(user,current,next,parts);
        if (!isDirector(user)) for (const leaf of changedLeaves(at(current,parts),v,parts)) assertWrite(user,current,next,leaf);
        for(const leaf of changedLeaves(at(current,parts),v,parts)) for(let length=leaf.length;length>0;length--) {
          const parent=at(next,leaf.slice(0,length));
          if(parent && typeof parent==='object' && 'fileId' in parent) assertFileReferences(user,root,parent,prepared.objects);
        }
      }
      assertFileReferences(user,root,updates,prepared.objects);
      validateAcademicChanges(current,next,updates);
      root.app=next;
      root.files={...root.files,...registrations};
      audit(root,user,'Cambio de datos',Object.keys(updates).join(', ').slice(0,4000));
      return root;
    };
    // Check permissions before uploading bytes, and check them again at commit time.
    apply(structuredClone(req.root),req.user);
    if(prepared.objects.size && !fileStore) fail(503,'El almacenamiento de archivos no está configurado.');
    const registrations={};
    for(const file of prepared.objects.values()) registrations[file.id]=await fileStore.save(file);
    await transaction(req,(root,user)=>apply(root,user,registrations));
    res.json({ok:true});
  });
  app.get('/api/files', async(req,res) => {
    if(!fileStore) fail(503,'El almacenamiento de archivos no está configurado.');
    const file=authorizedFile(req.user,req.root,req.query.path,req.query.quarantine==='1');
    res.attachment(file.name);
    // Never execute imported HTML or rely on a client-supplied content type.
    res.set({'Content-Type':'application/octet-stream','Content-Length':String(file.size),'Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'});
    await pipeline(fileStore.stream(file.id),res);
  });
  app.get('/api/migration/quarantine', (req,res) => {
    if(!isDirector(req.user)) fail(403,'Solo dirección puede revisar la migración.');
    res.json({data:req.root.migrationQuarantine || {},migration:req.root.migration || {}});
  });
  app.post('/api/users', async(req,res) => {
    const id = req.body?.id || 'u'+randomUUID();
    if (!/^u[a-zA-Z0-9-]{1,80}$/.test(id)) fail(400,'ID de usuario inválido.');
    const userInput = {...req.body}; delete userInput.id;
    const input = validateUser(userInput,id);
    await transaction(req,(root,actor) => {
      if (!isDirector(actor)) fail(403,'Solo dirección puede gestionar usuarios.');
      const users=root.app.usuarios ||= {}, existing=users[id];
      const duplicate=Object.values(users).find(u => u.email===input.email && u.id!==id);
      if (duplicate) fail(409,'Ese email ya está registrado.');
      if (existing && isDirector(existing) && existing.activo && (!input.activo || !isDirector(input)) && !Object.values(users).some(u => u.id!==id && u.activo && isDirector(u))) fail(409,'Debe quedar al menos un administrador activo.');
      root.access ||= {};
      if (existing) delete root.access[emailKey(existing.email)];
      users[id] = {...input, ...(existing?.googleSub ? {googleSub:existing.googleSub} : {})};
      root.access[emailKey(input.email)] = id;
      audit(root,actor,'Usuario',`${existing ? 'Actualizado' : 'Creado'} ${id}: ${input.email}; activo=${input.activo}; roles=${input.roles.join(',')}`);
      return root;
    });
    res.json({user:publicUser(input)});
  });
  // Bajas son lógicas: el usuario queda desactivado y sus referencias académicas se conservan.
  app.delete('/api/users/:id', async(req,res) => {
    await transaction(req,(root,actor) => {
      if (!isDirector(actor)) fail(403,'Solo dirección puede gestionar usuarios.');
      const target=root.app.usuarios?.[req.params.id];
      if (!target) fail(404,'Usuario no encontrado.');
      if (target.activo && isDirector(target) && !Object.values(root.app.usuarios).some(u => u.id!==target.id && u.activo && isDirector(u))) fail(409,'Debe quedar al menos un administrador activo.');
      target.activo=false;
      audit(root,actor,'Baja de usuario',`${target.id}: ${target.email}`);
      return root;
    });
    res.json({ok:true});
  });
  app.use('/api', (_req,res) => res.status(404).json({error:'Ruta no encontrada.'}));
  app.use(express.static(directory, {dotfiles:'deny',index:'index.html',maxAge:0}));
  app.use((error,_req,res,_next) => {
    if(res.headersSent) {res.destroy();return;}
    const status=error.status || 500;
    if (status>=500) console.error('Request failed:',error.message);
    res.status(status).json({error:status>=500 ? 'No se ha podido completar la operación.' : error.message});
  });
  return app;
}
