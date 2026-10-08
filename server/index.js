import { createApp } from './app.js';
import { createStore } from './store.js';
import { createIapVerifier } from './auth.js';

const app = createApp({
  store:createStore({projectId:process.env.GOOGLE_CLOUD_PROJECT,databaseURL:process.env.FIREBASE_DATABASE_URL}),
  verifyIdentity:createIapVerifier(process.env.IAP_AUDIENCE),
  origin:process.env.PUBLIC_ORIGIN,
  production:process.env.NODE_ENV !== 'development'
});
app.listen(Number(process.env.PORT || 8080),'0.0.0.0',() => console.log('Student Manager server ready'));
