import {api} from './database.js';
export async function renderMailConfig() {
  const panel=document.getElementById('mailConfig');if(!panel)return;panel.replaceChildren();
  const message=document.createElement('p');message.textContent='Comprobando la conexión de correo…';panel.append(message);
  try {
    const status=await api('/api/mail/status');
    message.textContent=status.connected&&status.enabled ? `Cuenta conectada: ${status.sender}. Los avisos se enviarán al registrar ausencias de menores o al solicitar recordatorios de tareas.` : status.configured ? `Remitente: ${status.sender}. Falta autorizar esta cuenta en Google para poder enviar los avisos.` : `Remitente: ${status.sender||'pendiente'}. Falta completar la configuración de Google Cloud.`;
    const detail=document.createElement('p');detail.textContent='El envío se realiza desde el servidor. Los recordatorios de tareas llegan al alumno y, si es menor, también a su tutor legal. Gmail confirma la aceptación del mensaje, pero no su entrega en la bandeja de entrada.';panel.append(detail);
    if(status.configured) {
      const button=document.createElement('button');button.className='btn btn-p';button.textContent=status.connected?'Volver a conectar la cuenta de Google':'Autorizar cuenta de Google';
      button.addEventListener('click',async()=>{button.disabled=true;try {const result=await api('/api/mail/connect',{method:'POST',body:{}});location.assign(result.url);}catch(e){message.textContent=e.message;button.disabled=false;}});panel.append(button);
    }
  }catch(error){message.textContent=error.message;}
}
