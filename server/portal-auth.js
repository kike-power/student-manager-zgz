import {createHash,createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import rateLimit from 'express-rate-limit';
import express from 'express';
import {setTimeout as delay} from 'node:timers/promises';
import {emailKey,normalizeEmail,isSelfService,fail} from './policy.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const cookieName='__Host-student-portal';
function cookie(req){const raw=(req.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);return /^[A-Za-z0-9_-]{43}$/.test(raw||'')?raw:null;}
function registered(root,email){const user=root.app?.usuarios?.[root.access?.[emailKey(email)]];return user?.activo===true&&user.email===email&&isSelfService(user)&&user.roles.length===1&&(user.alumnosIds||[]).some(id=>Object.hasOwn(root.app?.alumnos||{},id))?user:null;}
export function createPortalAuth({secret,mail,now=Date.now}) {
  if(!secret||Buffer.byteLength(secret)<32)throw new Error('PORTAL_AUTH_SECRET debe contener al menos 32 bytes privados.');
  const codeHash=(email,nonce,code)=>createHmac('sha256',secret).update(JSON.stringify([email,nonce,code])).digest('hex');
  return {
    async request(store,email) {
      email=normalizeEmail(email);const code=String(randomInt(100000000)).padStart(8,'0'),nonce=randomBytes(16).toString('hex');let claimed=false;
      await store.transaction(root=>{claimed=false;const user=registered(root,email);if(!user)return root;root.portalChallenges||={};const old=root.portalChallenges[emailKey(email)];if(old&&now()-old.createdAt<60000)return root;
        root.portalMailBudget||={start:now(),count:0};if(now()-root.portalMailBudget.start>3600000)root.portalMailBudget={start:now(),count:0};if(root.portalMailBudget.count>=100)return root;
        root.portalMailBudget.count++;for(const [key,value]of Object.entries(root.portalChallenges))if(value.expiresAt<now())delete root.portalChallenges[key];
        root.portalChallenges[emailKey(email)]={userId:user.id,nonce,codeHash:codeHash(email,nonce,code),createdAt:now(),expiresAt:now()+600000,attempts:0};claimed=true;return root;});
      if(claimed)try {await mail.send({to:email,subject:'Tu código de acceso · The Power FP Zaragoza',text:`Tu código para acceder al portal de alumnos y familias es:\n\n${code}\n\nCaduca en diez minutos y solo puede utilizarse una vez. Si no has solicitado este acceso, puedes ignorar este mensaje.\n\nThe Power FP Zaragoza`});}
      catch {await store.transaction(root=>{if(root.portalChallenges?.[emailKey(email)]?.nonce===nonce)delete root.portalChallenges[emailKey(email)];return root;});console.error('Portal access code delivery failed.');}
    },
    async verify(store,email,code) {
      email=normalizeEmail(email);if(!/^\d{8}$/.test(code||''))fail(401,'Código no válido o caducado.');const token=randomBytes(32).toString('base64url');let success=false;
      await store.transaction(root=>{success=false;const user=registered(root,email),challenge=root.portalChallenges?.[emailKey(email)];if(!user||!challenge||challenge.userId!==user.id||challenge.expiresAt<now()||challenge.attempts>=5)return root;
        challenge.attempts++;const supplied=Buffer.from(codeHash(email,challenge.nonce,code),'hex');if(!timingSafeEqual(supplied,Buffer.from(challenge.codeHash,'hex')))return root;
        root.portalSessions||={};for(const [key,value]of Object.entries(root.portalSessions))if(value.expiresAt<now())delete root.portalSessions[key];
        const sessions=Object.entries(root.portalSessions).filter(([,s])=>s.userId===user.id).sort((a,b)=>a[1].createdAt-b[1].createdAt);while(sessions.length>=5)delete root.portalSessions[sessions.shift()[0]];
        root.portalSessions[hash(token)]={userId:user.id,email,createdAt:now(),expiresAt:now()+8*3600000};delete root.portalChallenges[emailKey(email)];success=true;return root;});
      if(!success)fail(401,'Código no válido o caducado.');return token;
    },
    identity(req,root) {
      const token=cookie(req),session=token&&root.portalSessions?.[hash(token)];if(!session||session.expiresAt<now())fail(401,'Introduce tu correo para recibir un código de acceso.');
      const user=registered(root,session.email);if(!user||user.id!==session.userId)fail(403,'Esta cuenta no tiene acceso activo al portal.');
      return {email:session.email,sub:'portal:'+user.id,provider:'email'};
    },
    async logout(req,store){const token=cookie(req);if(token)await store.transaction(root=>{if(root.portalSessions)delete root.portalSessions[hash(token)];return root;});}
  };
}
export function mountPortalAuth({app,portalAuth,store,origin,production}) {
  const csrf=(req,_res,next)=>{if(req.get('origin')!==origin||req.get('x-requested-with')!=='student-manager')return next(Object.assign(new Error('Origen de petición no permitido.'),{status:403}));next();};
  const requestLimit=rateLimit({windowMs:15*60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false});
  const verifyLimit=rateLimit({windowMs:15*60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false});
  const json=express.json({limit:'2kb'}),cookieOptions={httpOnly:true,secure:true,sameSite:'lax',path:'/'};
  app.post('/api/auth/request-code',csrf,requestLimit,json,async(req,res)=>{if(Object.keys(req.body||{}).some(k=>k!=='email'))fail(400,'Petición inválida.');const started=Date.now();await portalAuth.request(store,req.body?.email);if(production)await delay(Math.max(0,3000+randomInt(300)-(Date.now()-started)));res.json({ok:true,message:'Si la cuenta está activa y autorizada, recibirás un código. Revisa también la carpeta de spam.'});});
  app.post('/api/auth/verify-code',csrf,verifyLimit,json,async(req,res)=>{if(Object.keys(req.body||{}).some(k=>!['email','code'].includes(k)))fail(400,'Petición inválida.');const token=await portalAuth.verify(store,req.body?.email,req.body?.code);res.cookie(cookieName,token,{...cookieOptions,maxAge:8*3600000});res.json({ok:true});});
  app.post('/api/auth/logout',csrf,json,async(req,res)=>{await portalAuth.logout(req,store);res.clearCookie(cookieName,cookieOptions);res.json({ok:true});});
}
