// Optional second factor for unlocking the vault: a passkey (fingerprint, face, device PIN or a
// security key) via WebAuthn. The assertion is verified on this device against the public key saved
// at enrolment — no server is involved.
import { fromB64, fromB64Url, randomBytes, toB64, toB64Url } from './crypto';
import { raw } from './db';

interface Enrolment {
  credId: string; // base64url
  spki: string; // base64
  alg: number; // -7 ES256, -257 RS256
  createdAt: string;
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && Boolean(navigator.credentials);
}

export async function passkeyEnrolled(): Promise<boolean> {
  return Boolean(await raw.get<Enrolment>('meta', 'passkey'));
}

export async function enrolPasskey(): Promise<void> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: 'Katharos', id: location.hostname },
      user: { id: randomBytes(16), name: 'katharos-vault', displayName: 'Katharos vault' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No passkey was created');
  const res = cred.response as AuthenticatorAttestationResponse;
  const spki = res.getPublicKey?.();
  const alg = res.getPublicKeyAlgorithm?.();
  if (!spki || (alg !== -7 && alg !== -257)) throw new Error('This browser cannot register a passkey for Katharos');
  await raw.put('meta', 'passkey', { credId: toB64Url(cred.rawId), spki: toB64(spki), alg, createdAt: new Date().toISOString() } satisfies Enrolment);
}

export async function removePasskey(): Promise<void> {
  await raw.del('meta', 'passkey');
}

/** Converts an ASN.1 DER ECDSA signature (as WebAuthn returns it) to the raw r||s form WebCrypto expects. */
function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let i = 2;
  const readInt = () => {
    i++; // 0x02
    const len = der[i++];
    let v = der.slice(i, i + len);
    i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  const out = new Uint8Array(64);
  out.set(r, 0);
  out.set(s, 32);
  return out;
}

/** Asks for the passkey and verifies the signed challenge locally. */
export async function verifyPasskey(): Promise<boolean> {
  const e = await raw.get<Enrolment>('meta', 'passkey');
  if (!e) return true;
  const challenge = randomBytes(32);
  const cred = (await navigator.credentials.get({
    publicKey: { challenge, rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: fromB64Url(e.credId) }], userVerification: 'required', timeout: 60_000 },
  })) as PublicKeyCredential | null;
  if (!cred) return false;
  const res = cred.response as AuthenticatorAssertionResponse;
  const clientData = JSON.parse(new TextDecoder().decode(res.clientDataJSON)) as { type: string; challenge: string; origin: string };
  if (clientData.type !== 'webauthn.get' || clientData.challenge !== toB64Url(challenge) || clientData.origin !== location.origin) return false;
  const auth = new Uint8Array(res.authenticatorData);
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.hostname)));
  if (!rpHash.every((b, k) => auth[k] === b)) return false;
  const flags = auth[32];
  if (!(flags & 0x01) || !(flags & 0x04)) return false; // user present and verified
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', res.clientDataJSON));
  const signed = new Uint8Array(auth.length + clientHash.length);
  signed.set(auth, 0);
  signed.set(clientHash, auth.length);
  const spki = fromB64(e.spki);
  if (e.alg === -7) {
    const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(new Uint8Array(res.signature)), signed);
  }
  const key = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, res.signature, signed);
}
