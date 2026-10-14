let snapshot = null;
const subscribers = new Set();
let timer = null;
export async function api(url, {method='GET',body} = {}) {
  const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:method==='GET' ? {} : {'Content-Type':'application/json','X-Requested-With':'student-manager'},...(body===undefined ? {} : {body:JSON.stringify(body)})});
  let data;
  try {data=await response.json();} catch {throw new Error('La sesión de Google ha caducado. Recarga la página.');}
  if (!response.ok) {
    if ((response.status===401 || response.status===403) && method==='GET') window.dispatchEvent(new CustomEvent('access-ended',{detail:data.error}));
    throw new Error(data.error || 'No se ha podido completar la operación.');
  }
  return data;
}
export async function downloadFile(path,name,{quarantine=false}={}) {
  const response=await fetch('/api/files?path='+encodeURIComponent(path)+(quarantine?'&quarantine=1':''),{credentials:'same-origin',cache:'no-store'});
  if(!response.ok) {
    let message='No se ha podido descargar el archivo.';
    try{message=(await response.json()).error || message;}catch{}
    if(response.status===401 || response.status===403) window.dispatchEvent(new CustomEvent('access-ended',{detail:message}));
    throw new Error(message);
  }
  const url=URL.createObjectURL(await response.blob());
  const link=document.createElement('a');link.href=url;link.download=name || 'archivo';link.rel='noopener';document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export const db = {};
export const ref = (_db,path) => String(path);
const result = value => ({val:() => value,exists:() => value!==null && value!==undefined});
const valueAt = path => path==='/' ? snapshot : path.split('/').filter(Boolean).reduce((node,key)=>node?.[key],snapshot) ?? null;
export async function get(path) {return result((await api('/api/database?path='+encodeURIComponent(path))).value);}
export async function sync() {
  snapshot=(await api('/api/database?path=%2F')).value || {};
  for (const entry of subscribers) entry.callback(result(valueAt(entry.path)));
}
async function write(path,op,value) {
  await api('/api/database',{method:'POST',body:{path,op,...(value===undefined ? {} : {value})}});
  await sync();
}
export const set = (path,value) => write(path,'set',value);
export const update = (path,value) => write(path,'update',value);
export const remove = path => write(path,'remove');
export const serverTimestamp = () => Date.now();
export function onValue(path,callback,error) {
  const entry={path,callback,error}; subscribers.add(entry);
  if (snapshot) callback(result(valueAt(path)));
  if (!timer) timer=setInterval(() => sync().catch(e => {for (const s of subscribers) s.error?.(e);}),15000);
  return () => {subscribers.delete(entry); if (!subscribers.size) {clearInterval(timer);timer=null;snapshot=null;}};
}
export function stopSync() {subscribers.clear();clearInterval(timer);timer=null;snapshot=null;}
