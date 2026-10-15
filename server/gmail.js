import {GoogleAuth, OAuth2Client} from 'google-auth-library';
import {fail} from './policy.js';
export const SEND_SCOPE='https://www.googleapis.com/auth/gmail.send';
export function createSecretStore(projectId) {
  const auth=new GoogleAuth({projectId,scopes:['https://www.googleapis.com/auth/cloud-platform']});
  const url=name=>`https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets/${name}`;
  return {
    async read(name) {
      const client=await auth.getClient();
      try {const {data}=await client.request({url:url(name)+'/versions/latest:access'});return JSON.parse(Buffer.from(data.payload.data,'base64').toString());}
      catch(error) {if(error.response?.status===404)return null;throw new Error('No se puede acceder a la configuración privada del correo.');}
    },
    async write(name,value) {
      const client=await auth.getClient();
      await client.request({url:url(name)+':addVersion',method:'POST',data:{payload:{data:Buffer.from(JSON.stringify(value)).toString('base64')}}});
    }
  };
}
export function mimeMessage(sender,to,subject,text) {
  for(const address of [sender,to])if(!/^[a-zA-Z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(address)||address.length>254)fail(400,'Dirección de correo inválida.');
  const words=[];let chunk='';
  for(const char of subject.replace(/[\r\n]/g,' ')){if(Buffer.byteLength(chunk+char)>42){words.push(chunk);chunk='';}chunk+=char;}
  if(chunk)words.push(chunk);
  const encoded=words.map(w=>'=?UTF-8?B?'+Buffer.from(w).toString('base64')+'?=').join('\r\n ');
  const body=Buffer.from(text.replace(/\r?\n/g,'\r\n')).toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';
  return Buffer.from(`From: ${sender}\r\nTo: ${to}\r\nSubject: ${encoded}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}`).toString('base64url');
}
export function createGmail({projectId,origin,sender,credentialsSecret='student-manager-mail-oauth',tokenSecret='student-manager-mail-token',enabled=false,secrets=createSecretStore(projectId),clientFactory=(...args)=>new OAuth2Client(...args)}) {
  const redirectUri=origin+'/oauth/gmail/callback';
  async function client() {
    const config=await secrets.read(credentialsSecret), c=config?.web||config;
    if(!c?.client_id||!c?.client_secret)fail(503,'Falta configurar el cliente de Google para el correo.');
    return {oauth:clientFactory(c.client_id,c.client_secret,redirectUri),clientId:c.client_id};
  }
  return {
    sender,
    async status() {
      const c=await secrets.read(credentialsSecret), token=await secrets.read(tokenSecret);
      const configured=!!((c?.web||c)?.client_id&&(c?.web||c)?.client_secret);
      return {sender,configured,connected:configured&&token?.sender===sender&&token?.clientId===(c?.web||c)?.client_id&&!!token?.refresh_token,enabled};
    },
    async authorize(state,challenge) {
      const {oauth}=await client();
      return oauth.generateAuthUrl({access_type:'offline',scope:['openid','email',SEND_SCOPE],prompt:'consent',login_hint:sender,state,code_challenge:challenge,code_challenge_method:'S256'});
    },
    async connect(code,codeVerifier) {
      const {oauth,clientId}=await client();
      const {tokens}=await oauth.getToken({code,codeVerifier,redirect_uri:redirectUri});
      if(!tokens.id_token||!tokens.refresh_token||!tokens.scope?.split(' ').includes(SEND_SCOPE))fail(403,'Google no ha autorizado el envío. Repite la conexión aceptando ese permiso.');
      const ticket=await oauth.verifyIdToken({idToken:tokens.id_token,audience:clientId}), identity=ticket.getPayload();
      if(identity?.email_verified!==true||identity.email?.toLowerCase()!==sender)fail(403,'Debes autorizar exactamente la cuenta remitente indicada.');
      await secrets.write(tokenSecret,{sender,clientId,refresh_token:tokens.refresh_token,authorizedAt:new Date().toISOString()});
    },
    async send({to,subject,text}) {
      if(!enabled)fail(503,'Los envíos de correo están desactivados.');
      const {oauth,clientId}=await client(), token=await secrets.read(tokenSecret);
      if(token?.sender!==sender||token?.clientId!==clientId||!token?.refresh_token)fail(503,'Falta autorizar la cuenta remitente en Configuración → Correo.');
      oauth.setCredentials({refresh_token:token.refresh_token});
      // Do not retry message POSTs: an interrupted response can already be accepted.
      try {const {data}=await oauth.request({url:'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',method:'POST',data:{raw:mimeMessage(sender,to,subject,text)},retry:false,timeout:15000});if(!data.id)throw new Error('Missing Gmail message id');return data.id;}
      catch(error) {const status=error.response?.status;const e=new Error(status===401||status===403?'Google ha rechazado la autorización de correo. Vuelve a conectar la cuenta.':'No se ha podido confirmar el envío con Gmail.');e.status=502;e.uncertain=!status||status>=500;throw e;}
    }
  };
}
