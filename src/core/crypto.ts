// Client-side cryptography (WebCrypto only — nothing leaves the device unencrypted).

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITERATIONS = 600_000;

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toB64Url(buf: ArrayBuffer | Uint8Array): string {
  return toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64Url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function randomId(prefix = ''): string {
  return prefix + toB64Url(randomBytes(12));
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface Sealed {
  iv: string;
  ct: string;
}

export async function sealBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<{ iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer }> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv, ct };
}

export async function openBytes(key: CryptoKey, iv: Uint8Array<ArrayBuffer>, ct: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
}

export async function sealJson(key: CryptoKey, value: unknown): Promise<Sealed> {
  const { iv, ct } = await sealBytes(key, enc.encode(JSON.stringify(value)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function openJson<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const plain = await openBytes(key, fromB64(sealed.iv), fromB64(sealed.ct));
  return JSON.parse(dec.decode(plain)) as T;
}

/** A fresh random key, exportable — used for one-off buyer share links. */
export async function newShareKey(): Promise<{ key: CryptoKey; raw: Uint8Array<ArrayBuffer> }> {
  const raw = randomBytes(32);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, raw };
}

export async function importShareKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function streamBytes(input: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([input]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function deflate(data: string): Promise<Uint8Array<ArrayBuffer>> {
  return streamBytes(enc.encode(data), new CompressionStream('deflate-raw'));
}

export async function inflate(data: Uint8Array<ArrayBuffer>): Promise<string> {
  return dec.decode(await streamBytes(data, new DecompressionStream('deflate-raw')));
}

/** Rates passphrase strength 0–4 using length and character variety (no dictionary download needed). */
export function passphraseScore(p: string): number {
  if (p.length < 8) return 0;
  let classes = 0;
  if (/[a-z]/.test(p)) classes++;
  if (/[A-Z]/.test(p)) classes++;
  if (/\d/.test(p)) classes++;
  if (/[^A-Za-z0-9]/.test(p)) classes++;
  const words = p.trim().split(/\s+/).length;
  let score = p.length >= 16 || words >= 4 ? 3 : p.length >= 12 ? 2 : 1;
  if (classes >= 3) score++;
  return Math.min(4, score);
}
