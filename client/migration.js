import {api,downloadFile} from './database.js';

export function initMigrationReview() {
  const button=document.getElementById('reviewMigrationButton');
  const panel=document.getElementById('migrationReview');
  if(!button || !panel) return;
  button.addEventListener('click',async()=>{
    button.disabled=true;panel.replaceChildren();
    try {
      const result=await api('/api/migration/quarantine');
      if(!result.migration.sourceSha256) {panel.textContent='Todavía no hay una migración importada.';return;}
      const summary=document.createElement('p');
      summary.textContent='Los registros siguientes se conservaron para revisión y no conceden acceso a la aplicación.';panel.append(summary);
      const heading=document.createElement('h4');heading.textContent='Perfiles históricos';panel.append(heading);
      const list=document.createElement('ul');
      for(const user of Object.values(result.data.usuarios || {})) {
        const item=document.createElement('li');item.textContent=`${user.nombre || 'Sin nombre'} · ${user.email || 'Sin email'}`;list.append(item);
      }
      panel.append(list);
      const documents=[];
      function walk(value,path=[]) {
        if(!value || typeof value!=='object') return;
        if(value.fileId) documents.push({path:path.join('/'),document:value});
        for(const [key,item] of Object.entries(value)) if(item && typeof item==='object') walk(item,[...path,key]);
      }
      walk(result.data.orphans || {},['orphans']);
      const filesHeading=document.createElement('h4');filesHeading.textContent=`Archivos sin vínculo válido (${documents.length})`;panel.append(filesHeading);
      for(const {path,document:doc} of documents) {
        const row=document.createElement('p');row.textContent=doc.nombre || 'Archivo';
        const download=document.createElement('button');download.className='btn btn-sm';download.textContent='Descargar para revisar';
        download.addEventListener('click',async()=>{try{await downloadFile(path,doc.nombre,{quarantine:true});}catch(error){alert(error.message);}});
        row.append(' ',download);panel.append(row);
      }
    } catch(error) {panel.textContent=error.message;}
    finally {button.disabled=false;}
  });
}
