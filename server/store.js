import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

export function createStore({projectId, databaseURL}) {
  if (!projectId || !databaseURL) throw new Error('GOOGLE_CLOUD_PROJECT y FIREBASE_DATABASE_URL son obligatorios.');
  if (!databaseURL.startsWith(`https://${projectId}`)) throw new Error('La base de datos debe pertenecer al proyecto configurado.');
  const app = initializeApp({ credential:applicationDefault(), projectId, databaseURL });
  const root = getDatabase(app).ref('/');
  return {
    async read() { return (await root.get()).val() || {}; },
    async transaction(change) {
      // get() does not populate the transaction cache. Keep a listener alive so
      // the first callback sees the existing users instead of an initial null.
      const keepAlive = () => {};
      root.on('value', keepAlive);
      try {
        await root.once('value');
        let failure;
        const result = await root.transaction(value => {
          try {
            const next=change(value || {});
            if(Buffer.byteLength(JSON.stringify(next))>8*1024*1024) throw new Error('Los metadatos superan el tamaño seguro; revisa archivado y retención.');
            return next;
          }
          catch(error) { failure=error; return undefined; }
        }, undefined, false);
        if (!result.committed) throw failure || new Error('La operación no pudo completarse.');
        return result.snapshot.val();
      } finally { root.off('value', keepAlive); }
    }
  };
}
