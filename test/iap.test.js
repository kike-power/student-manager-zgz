import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createIapVerifier } from '../server/auth.js';
const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
const audience='/projects/123/locations/europe-west1/services/test';
const client=new OAuth2Client();
client.getIapPublicKeys=async()=>({pubkeys:{key:publicKey.export({type:'spki',format:'pem'})}});
const verify=createIapVerifier(audience,{client});
function token(change={},header={}) {
  const now=Math.floor(Date.now()/1000);
  const payload={iss:'https://cloud.google.com/iap',aud:audience,iat:now-5,exp:now+300,sub:'google-sub',email:'user@thepower.education',hd:'thepower.education',...change};
  const input=[{alg:'ES256',kid:'key',...header},payload].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return input+'.'+sign('sha256',Buffer.from(input),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
const req=value=>({get:()=>value});
test('verifies a signed IAP identity for the configured audience',async()=>assert.equal((await verify(req(token()))).email,'user@thepower.education'));
test('rejects forged signature, wrong audience, wrong issuer and expired tokens',async()=>{
  for(const t of [token({aud:'other'}),token({iss:'https://evil.example'}),token({iat:1,exp:2}),token().slice(0,-6)+'AAAAAA']) await assert.rejects(()=>verify(req(t)));
});
test('requires a corporate Workspace hosted domain and exact email suffix',async()=>{
  for(const claims of [{hd:undefined},{hd:'gmail.com'},{email:'user@thepower.education.evil'},{hd:'thepower.education.evil'}]) await assert.rejects(()=>verify(req(token(claims))));
});
test('rejects unsigned headers, wrong algorithm and missing JWT',async()=>{
  await assert.rejects(()=>verify(req(undefined)));
  await assert.rejects(()=>verify(req(token({}, {alg:'none'}))));
});
