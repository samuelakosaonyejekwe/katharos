// IndexedDB storage. Client data (matters, documents, secrets) is sealed with the vault key;
// only public data (live feeds) and non-identifying settings are stored in the clear.
import { deriveKey, fromB64, openBytes, openJson, randomBytes, sealBytes, sealJson, toB64, type Sealed } from './crypto';

const DB_NAME = 'katharos';
const DB_VERSION = 1;
export type StoreName = 'meta' | 'matters' | 'files' | 'secrets' | 'feeds' | 'outbox';

let dbp: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ['meta', 'matters', 'files', 'secrets', 'feeds', 'outbox'] as StoreName[]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => req.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database blocked by another open tab'));
    });
  }
  return dbp;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error ?? req.error);
        t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
      }),
  );
}

export const raw = {
  get: <T>(store: StoreName, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
  put: (store: StoreName, key: string, value: unknown) => tx(store, 'readwrite', (s) => s.put(value, key)),
  del: (store: StoreName, key: string) => tx(store, 'readwrite', (s) => s.delete(key)),
  keys: (store: StoreName) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()).then((k) => k.map(String)),
  all: <T>(store: StoreName) => tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  clear: (store: StoreName) => tx(store, 'readwrite', (s) => s.clear()),
};

// ---------------------------------------------------------------- vault

interface VaultMeta {
  salt: string;
  iterations: number;
  check: Sealed;
  createdAt: string;
}

const CHECK = 'katharos-vault-v1';
let vaultKey: CryptoKey | null = null;
const lockListeners = new Set<(locked: boolean) => void>();

export const vault = {
  async exists(): Promise<boolean> {
    return Boolean(await raw.get<VaultMeta>('meta', 'vault'));
  },
  isUnlocked(): boolean {
    return vaultKey !== null;
  },
  async create(passphrase: string): Promise<void> {
    const salt = randomBytes(16);
    const iterations = 600_000;
    const key = await deriveKey(passphrase, salt, iterations);
    const meta: VaultMeta = { salt: toB64(salt), iterations, check: await sealJson(key, CHECK), createdAt: new Date().toISOString() };
    await raw.put('meta', 'vault', meta);
    vaultKey = key;
    lockListeners.forEach((l) => l(false));
  },
  async unlock(passphrase: string): Promise<boolean> {
    const meta = await raw.get<VaultMeta>('meta', 'vault');
    if (!meta) return false;
    const key = await deriveKey(passphrase, fromB64(meta.salt), meta.iterations);
    try {
      if ((await openJson<string>(key, meta.check)) !== CHECK) return false;
    } catch {
      return false;
    }
    vaultKey = key;
    lockListeners.forEach((l) => l(false));
    return true;
  },
  lock(): void {
    vaultKey = null;
    lockListeners.forEach((l) => l(true));
  },
  onChange(fn: (locked: boolean) => void): () => void {
    lockListeners.add(fn);
    return () => lockListeners.delete(fn);
  },
  /** Re-encrypts every sealed record under a new passphrase. */
  async rekey(newPassphrase: string): Promise<void> {
    const old = requireKey();
    const stores: ('matters' | 'secrets')[] = ['matters', 'secrets'];
    const plain: Record<string, [string, unknown][]> = {};
    for (const st of stores) {
      plain[st] = [];
      for (const k of await raw.keys(st)) plain[st].push([k, await openJson(old, (await raw.get<Sealed>(st, k))!)]);
    }
    const files: [string, ArrayBuffer, Omit<SealedFile, 'iv' | 'ct'>][] = [];
    for (const k of await raw.keys('files')) {
      const f = (await raw.get<SealedFile>('files', k))!;
      files.push([k, await openBytes(old, fromB64(f.iv), f.ct), { name: f.name, type: f.type, size: f.size }]);
    }
    await vault.create(newPassphrase);
    for (const st of stores) for (const [k, v] of plain[st]) await sealed.put(st, k, v);
    for (const [k, bytes, info] of files) await putFile(k, new Blob([bytes], { type: info.type }), info.name);
  },
};

function requireKey(): CryptoKey {
  if (!vaultKey) throw new Error('Vault is locked');
  return vaultKey;
}

export const sealed = {
  async get<T>(store: 'matters' | 'secrets', key: string): Promise<T | undefined> {
    const v = await raw.get<Sealed>(store, key);
    return v ? openJson<T>(requireKey(), v) : undefined;
  },
  async put(store: 'matters' | 'secrets', key: string, value: unknown): Promise<void> {
    await raw.put(store, key, await sealJson(requireKey(), value));
  },
  async all<T>(store: 'matters' | 'secrets'): Promise<T[]> {
    const key = requireKey();
    const rows = await raw.all<Sealed>(store);
    return Promise.all(rows.map((r) => openJson<T>(key, r)));
  },
  del: (store: 'matters' | 'secrets', key: string) => raw.del(store, key),
};

interface SealedFile {
  iv: string;
  ct: ArrayBuffer;
  name: string;
  type: string;
  size: number;
}

export async function putFile(id: string, blob: Blob, name: string): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { iv, ct } = await sealBytes(requireKey(), bytes);
  await raw.put('files', id, { iv: toB64(iv), ct, name, type: blob.type, size: blob.size } satisfies SealedFile);
}

export async function getFile(id: string): Promise<File | undefined> {
  const f = await raw.get<SealedFile>('files', id);
  if (!f) return undefined;
  const plain = await openBytes(requireKey(), fromB64(f.iv), f.ct);
  return new File([plain], f.name, { type: f.type });
}

export const delFile = (id: string) => raw.del('files', id);

/** Asks the browser not to evict this origin's storage under pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- reminders (read by the service worker)

export interface Reminder {
  id: string;
  matterId: string;
  label: string;
  due: string;
}

function openReminderDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('katharos-reminders', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('reminders', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function replaceReminders(list: Reminder[]): Promise<void> {
  const db = await openReminderDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('reminders', 'readwrite');
    const st = t.objectStore('reminders');
    st.clear();
    for (const r of list) st.put(r);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  db.close();
}

export async function wipeEverything(): Promise<void> {
  vault.lock();
  const db = await openDb();
  db.close();
  dbp = null;
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase('katharos-reminders');
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
  try {
    localStorage.clear();
  } catch {
    /* storage may be unavailable */
  }
}
