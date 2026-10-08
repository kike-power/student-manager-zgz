import { OAuth2Client } from 'google-auth-library';
import { corporateEmail, DOMAINS, fail } from './policy.js';

export function createIapVerifier(audience, {client = new OAuth2Client()} = {}) {
  if (!audience) throw new Error('IAP_AUDIENCE es obligatorio.');
  return async request => {
    const token = request.get('x-goog-iap-jwt-assertion');
    if (!token || token.length > 16000) fail(401, 'Inicia sesión con Google.');
    try {
      const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
      if (header.alg !== 'ES256') fail(401,'Firma no válida.');
      const { pubkeys } = await client.getIapPublicKeys();
      const ticket = await client.verifySignedJwtWithCertsAsync(token, pubkeys, audience, ['https://cloud.google.com/iap']);
      const claims = ticket.getPayload();
      const now = Date.now()/1000;
      if (!claims?.sub || !claims.email || !DOMAINS.includes(claims.hd)) fail(403, 'Usa una cuenta de Google Workspace autorizada.');
      if (!Number.isFinite(claims.exp) || !Number.isFinite(claims.iat) || claims.exp < now-30 || claims.iat > now+30 || claims.exp-claims.iat > 660) fail(401,'Sesión de Google no válida.');
      return { sub:claims.sub, email:corporateEmail(claims.email), hd:claims.hd };
    } catch(error) {
      if (error.status) throw error;
      fail(401, 'No se pudo verificar la sesión de Google.');
    }
  };
}
