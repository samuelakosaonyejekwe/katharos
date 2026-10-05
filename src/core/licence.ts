// Firm licences. The public site serves everyone, but the lawyer workbench (Desk) opens only with a
// licence key issued by the operator. Keys are ECDSA P-256 signatures over the licence details; this
// app holds only the public key, so it can check a licence but never create one.
import { fromB64Url } from './crypto';

const PUBLIC_KEY: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'WM-_hFn51lbBq8RQIRNF_EklZOGSKcjSn6kSwOG4aBY',
  y: '5ELDUvK_LuTEw8VxoBurXK7sg7EGrO4pjWgFBjGYMsg',
};

const STORE = 'katharos.licence';

export interface Licence {
  v: 1;
  id: string;
  firm: string;
  iat: string;
  exp: string | null;
  scope: string[];
}

let verified: Licence | null = null;

export async function verifyLicence(key: string): Promise<Licence> {
  const [tag, body, sig] = key.trim().split('.');
  if (tag !== 'KTH1' || !body || !sig) throw new Error('This is not a Katharos licence key.');
  const pub = await crypto.subtle.importKey('jwk', PUBLIC_KEY, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64Url(sig), new TextEncoder().encode(body));
  if (!ok) throw new Error('This licence key is not valid.');
  const lic = JSON.parse(new TextDecoder().decode(fromB64Url(body))) as Licence;
  if (lic.v !== 1 || !lic.scope?.includes('desk')) throw new Error('This licence does not include the Desk.');
  if (lic.exp && lic.exp < new Date().toISOString().slice(0, 10)) throw new Error(`This licence expired on ${lic.exp}.`);
  return lic;
}

/** Checks the stored licence once per session (works offline: verification is local). */
export async function activeLicence(): Promise<Licence | null> {
  if (verified) return verified;
  let key: string | null = null;
  try {
    key = localStorage.getItem(STORE);
  } catch {
    return null;
  }
  if (!key) return null;
  try {
    verified = await verifyLicence(key);
    return verified;
  } catch {
    return null;
  }
}

export async function activateLicence(key: string): Promise<Licence> {
  const lic = await verifyLicence(key);
  localStorage.setItem(STORE, key.trim());
  verified = lic;
  return lic;
}

export function removeLicence(): void {
  verified = null;
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
}
