import { createApp } from './app.js';
import { createStore } from './store.js';
import { createIapVerifier } from './auth.js';
import { createFileStore } from './files.js';
import { createGmail } from './gmail.js';

const app = createApp({
  store:createStore({projectId:process.env.GOOGLE_CLOUD_PROJECT,databaseURL:process.env.FIREBASE_DATABASE_URL}),
  fileStore:createFileStore({projectId:process.env.GOOGLE_CLOUD_PROJECT,bucketName:process.env.ATTACHMENTS_BUCKET}),
  mail:process.env.MAIL_SENDER ? createGmail({projectId:process.env.GOOGLE_CLOUD_PROJECT,origin:process.env.PUBLIC_ORIGIN,sender:process.env.MAIL_SENDER,enabled:process.env.MAIL_ENABLED==='true'}) : undefined,
  verifyIdentity:createIapVerifier(process.env.IAP_AUDIENCE),
  origin:process.env.PUBLIC_ORIGIN,
  production:process.env.NODE_ENV !== 'development'
});
app.listen(Number(process.env.PORT || 8080),'0.0.0.0',() => console.log('Student Manager server ready'));
