import { createApp } from './app.js';
import { createStore } from './store.js';
import { createIapVerifier } from './auth.js';
import { createFileStore } from './files.js';
import { createPortalAuth } from './portal-auth.js';
import { createGmail } from './gmail.js';

const mail=process.env.MAIL_SENDER ? createGmail({projectId:process.env.GOOGLE_CLOUD_PROJECT,origin:process.env.PUBLIC_ORIGIN,sender:process.env.MAIL_SENDER,enabled:process.env.MAIL_ENABLED==='true'}) : undefined;
const portal=process.env.ACCESS_MODE==='portal';
if(portal&&!mail)throw new Error('El portal necesita un proveedor de correo configurado.');
const app = createApp({
  store:createStore({projectId:process.env.GOOGLE_CLOUD_PROJECT,databaseURL:process.env.FIREBASE_DATABASE_URL}),
  fileStore:createFileStore({projectId:process.env.GOOGLE_CLOUD_PROJECT,bucketName:process.env.ATTACHMENTS_BUCKET}),
  mail,
  portalAuth:portal?createPortalAuth({secret:process.env.PORTAL_AUTH_SECRET,mail}):undefined,
  portalUrl:process.env.PORTAL_URL,
  verifyIdentity:portal?undefined:createIapVerifier(process.env.IAP_AUDIENCE),
  origin:process.env.PUBLIC_ORIGIN,
  production:process.env.NODE_ENV !== 'development'
});
app.listen(Number(process.env.PORT || 8080),'0.0.0.0',() => console.log('Student Manager server ready'));
