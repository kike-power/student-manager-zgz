let mode='google';
async function post(path,body={}){const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Requested-With':'student-manager'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error||'No se ha podido completar el acceso.');return value;}
export async function configureLogin(){
  const response=await fetch('/auth-config',{cache:'no-store'}),config=await response.json();mode=config.mode;
  if(mode!=='portal')return;
  document.getElementById('googleLoginButton').style.display='none';document.getElementById('googleSwitchAccount').style.display='none';
  document.getElementById('loginDescription').textContent='Portal de alumnos y familias. Introduce el correo dado de alta por el centro y recibe un código para consultar tus alumnos vinculados.';
  const form=document.getElementById('portalLogin');form.style.display='';
  form.addEventListener('submit',async event=>{event.preventDefault();const button=document.getElementById('portalRequestCode'),message=document.getElementById('portalLoginMessage');button.disabled=true;
    try{const result=await post('/api/auth/request-code',{email:document.getElementById('portalEmail').value.trim()});message.textContent=result.message;document.getElementById('portalCodeForm').style.display='';document.getElementById('portalCode').focus();}catch(error){message.textContent=error.message;}finally{button.disabled=false;}});
  document.getElementById('portalCodeForm').addEventListener('submit',async event=>{event.preventDefault();const button=document.getElementById('portalVerifyCode'),message=document.getElementById('portalLoginMessage');button.disabled=true;
    try{await post('/api/auth/verify-code',{email:document.getElementById('portalEmail').value.trim(),code:document.getElementById('portalCode').value.trim()});location.reload();}catch(error){message.textContent=error.message;button.disabled=false;}});
}
export async function logoutPortal(){if(mode!=='portal')return false;await post('/api/auth/logout');location.reload();return true;}
