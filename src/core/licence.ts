// Licences for the professional side of Katharos (law firms, developers, banks). Two kinds:
//  • Paid licences sold through Lemon Squeezy (merchant of record: it charges the customer, handles
//    EU VAT and emails the key). This browser activates and re-validates the key directly with the
//    Lemon Squeezy licence API — no server to run or pay for.
//  • Operator-issued keys (KTH1…) for pilots and partners: ECDSA P-256 signatures checked here with
//    the public key only, so this app can verify them but never create one.
import { fromB64Url } from './crypto';
import { publicConfig, type Role } from './config';

export type { Role };
export const ROLES: Role[] = ['lawyer', 'developer', 'bank'];

const PUBLIC_KEY: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'WM-_hFn51lbBq8RQIRNF_EklZOGSKcjSn6kSwOG4aBY',
  y: '5ELDUvK_LuTEw8VxoBurXK7sg7EGrO4pjWgFBjGYMsg',
};

const STORE = 'katharos.licence.v2';
const LEGACY = 'katharos.licence';
const LS_API = 'https://api.lemonsqueezy.com/v1/licenses';
const REVALIDATE_MS = 24 * 3600 * 1000;
const OFFLINE_GRACE_MS = 14 * 24 * 3600 * 1000;

export interface Licence {
  kind: 'kth1' | 'store';
  id: string;
  holder: string;
  roles: Role[];
  exp: string | null;
  key: string;
  instanceId?: string;
  lastValidated: number;
}

let current: Licence | null = null;

function save(l: Licence | null): void {
  current = l;
  try {
    if (l) localStorage.setItem(STORE, JSON.stringify(l));
    else localStorage.removeItem(STORE);
    localStorage.removeItem(LEGACY);
  } catch {
    /* private mode: licence lasts for this session only */
  }
}

function load(): Licence | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw) as Licence;
    const legacy = localStorage.getItem(LEGACY);
    if (legacy) return { kind: 'kth1', id: '', holder: '', roles: [], exp: null, key: legacy, lastValidated: 0 };
  } catch {
    /* ignore */
  }
  return null;
}

// ------------------------------------------------------------------ operator-issued keys

async function verifyKth1(key: string): Promise<Licence> {
  const [tag, body, sig] = key.trim().split('.');
  if (tag !== 'KTH1' || !body || !sig) throw new Error('This is not a Katharos licence key.');
  const pub = await crypto.subtle.importKey('jwk', PUBLIC_KEY, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64Url(sig), new TextEncoder().encode(body));
  if (!ok) throw new Error('This licence key is not valid.');
  const p = JSON.parse(new TextDecoder().decode(fromB64Url(body))) as { v: number; id: string; firm: string; exp: string | null; scope: string[] };
  const roles = p.scope.includes('desk') ? [...ROLES] : (p.scope.filter((s) => (ROLES as string[]).includes(s)) as Role[]);
  if (p.v !== 1 || !roles.length) throw new Error('This licence does not include any Katharos professional tools.');
  if (p.exp && p.exp < new Date().toISOString().slice(0, 10)) throw new Error(`This licence expired on ${p.exp}.`);
  return { kind: 'kth1', id: p.id, holder: p.firm, roles, exp: p.exp, key: key.trim(), lastValidated: Date.now() };
}

// ------------------------------------------------------------------ paid store keys (Lemon Squeezy)

interface StoreReply {
  activated?: boolean;
  valid?: boolean;
  deactivated?: boolean;
  error: string | null;
  license_key?: { status: string; expires_at: string | null };
  instance?: { id: string } | null;
  meta?: { store_id: number; variant_id: number; customer_name: string; product_name: string; variant_name: string };
}

async function storeCall(action: 'activate' | 'validate' | 'deactivate', params: Record<string, string>): Promise<StoreReply> {
  // Form-encoded POST: a "simple" cross-origin request, so no preflight and no server in between.
  const res = await fetch(`${LS_API}/${action}`, { method: 'POST', headers: { accept: 'application/json' }, body: new URLSearchParams(params) });
  return (await res.json()) as StoreReply;
}

async function rolesFromStore(meta: StoreReply['meta']): Promise<Role[]> {
  const cfg = await publicConfig();
  if (!meta || cfg.lemonsqueezy.storeId === null || meta.store_id !== cfg.lemonsqueezy.storeId) throw new Error('This licence key was not issued for Katharos.');
  const role = cfg.lemonsqueezy.variants[String(meta.variant_id)];
  if (!role) throw new Error('This licence plan is not recognised. Contact Katharos.');
  return [role];
}

function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device';
  return `Katharos on ${os} · ${new Date().toISOString().slice(0, 10)}`;
}

async function activateStoreKey(key: string): Promise<Licence> {
  if ((await publicConfig()).lemonsqueezy.storeId === null) throw new Error('Paid licences are not enabled on this copy of Katharos yet.');
  const r = await storeCall('activate', { license_key: key.trim(), instance_name: deviceName() });
  if (!r.activated || !r.instance) throw new Error(r.error ?? 'The licence could not be activated.');
  try {
    const roles = await rolesFromStore(r.meta);
    return { kind: 'store', id: r.instance.id, holder: r.meta!.customer_name, roles, exp: r.license_key?.expires_at?.slice(0, 10) ?? null, key: key.trim(), instanceId: r.instance.id, lastValidated: Date.now() };
  } catch (e) {
    await storeCall('deactivate', { license_key: key.trim(), instance_id: r.instance.id }).catch(() => undefined);
    throw e;
  }
}

async function revalidate(l: Licence): Promise<Licence | null> {
  if (l.kind !== 'store' || !l.instanceId) return l;
  if (Date.now() - l.lastValidated < REVALIDATE_MS) return l;
  try {
    const r = await storeCall('validate', { license_key: l.key, instance_id: l.instanceId });
    if (!r.valid) return null; // cancelled, expired, refunded or deactivated
    const next = { ...l, exp: r.license_key?.expires_at?.slice(0, 10) ?? l.exp, lastValidated: Date.now() };
    save(next);
    return next;
  } catch {
    // Offline: keep working for a grace period, then ask for a connection.
    return Date.now() - l.lastValidated < OFFLINE_GRACE_MS ? l : null;
  }
}

// ------------------------------------------------------------------ public API

export async function activeLicence(): Promise<Licence | null> {
  if (current && (current.kind === 'kth1' || Date.now() - current.lastValidated < REVALIDATE_MS)) return current;
  const stored = current ?? load();
  if (!stored) return null;
  try {
    const l = stored.kind === 'kth1' ? await verifyKth1(stored.key) : await revalidate(stored);
    if (!l) {
      save(null);
      return null;
    }
    current = l;
    return l;
  } catch {
    save(null);
    return null;
  }
}

export async function activateLicence(key: string): Promise<Licence> {
  const k = key.trim();
  const l = k.startsWith('KTH1.') ? await verifyKth1(k) : await activateStoreKey(k);
  save(l);
  return l;
}

export async function removeLicence(): Promise<void> {
  const l = current ?? load();
  if (l?.kind === 'store' && l.instanceId) await storeCall('deactivate', { license_key: l.key, instance_id: l.instanceId }).catch(() => undefined);
  save(null);
}

export function hasRole(role: Role): boolean {
  return Boolean(current?.roles.includes(role));
}

export const ROLE_LABEL: Record<Role, string> = { lawyer: 'Law firm', developer: 'Developer', bank: 'Bank' };
