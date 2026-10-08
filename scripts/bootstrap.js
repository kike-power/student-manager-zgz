import { createStore } from '../server/store.js';
import { emailKey, validateUser, isDirector } from '../server/policy.js';
const emails=(process.env.BOOTSTRAP_ADMINS || '').split(',').filter(Boolean);
if (!emails.length) throw new Error('Indica BOOTSTRAP_ADMINS=email1,email2.');
const users=emails.map((email,i) => validateUser({nombre:email.split('@')[0],email,roles:['director'],grupos:[],materias:[],activo:true},'uadmin'+i));
const store=createStore({projectId:process.env.GOOGLE_CLOUD_PROJECT,databaseURL:process.env.FIREBASE_DATABASE_URL});
await store.transaction(root => {
  if (Object.values(root.app?.usuarios || {}).some(u => u.activo && isDirector(u))) throw new Error('Ya existe dirección; usa el gestor de usuarios.');
  root.app ||= {};
  root.app.config ||= {schoolName:'ThePower · Zaragoza',curso:'2026–2027'};
  root.app.usuarios ||= {}; root.access ||= {};
  for (const u of users) {root.app.usuarios[u.id]=u;root.access[emailKey(u.email)]=u.id;}
  return root;
});
console.log('Administradores iniciales preparados.');
process.exit(0);
