// Encrypted exports: full-vault backups (already sealed with the vault key) and single-matter
// files (sealed with a password chosen at export). Nothing is ever exported in the clear.
import { deflate, deriveKey, fromB64, inflate, openBytes, randomBytes, sealBytes, toB64 } from './crypto';
import { raw } from './db';

interface StoredFile {
  iv: string;
  ct: ArrayBuffer;
  name: string;
  type: string;
  size: number;
}

export async function exportVault(): Promise<Blob> {
  const stores: Record<string, [string, unknown][]> = {};
  for (const st of ['matters', 'secrets'] as const) {
    stores[st] = [];
    for (const k of await raw.keys(st)) stores[st].push([k, await raw.get(st, k)]);
  }
  const files: [string, Omit<StoredFile, 'ct'> & { ct: string }][] = [];
  for (const k of await raw.keys('files')) {
    const f = (await raw.get<StoredFile>('files', k))!;
    files.push([k, { ...f, ct: toB64(f.ct) }]);
  }
  const payload = { format: 'katharos-backup', version: 1, createdAt: new Date().toISOString(), vault: await raw.get('meta', 'vault'), stores, files };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export async function restoreVault(file: File): Promise<{ matters: number; files: number }> {
  const j = JSON.parse(await file.text());
  if (j.format !== 'katharos-backup' || !j.vault) throw new Error('This is not a Katharos backup file');
  for (const st of ['matters', 'secrets', 'files'] as const) await raw.clear(st);
  await raw.put('meta', 'vault', j.vault);
  for (const st of ['matters', 'secrets'] as const) for (const [k, v] of j.stores[st] ?? []) await raw.put(st, k, v);
  for (const [k, f] of j.files ?? []) await raw.put('files', k, { ...f, ct: fromB64(f.ct).buffer });
  return { matters: (j.stores.matters ?? []).length, files: (j.files ?? []).length };
}

export async function sealExport(value: unknown, password: string, kind: string): Promise<Blob> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  const { iv, ct } = await sealBytes(key, await deflate(JSON.stringify(value)));
  return new Blob([JSON.stringify({ format: kind, version: 1, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) })], { type: 'application/json' });
}

export async function openExport<T>(file: File, password: string, kind: string): Promise<T> {
  const j = JSON.parse(await file.text());
  if (j.format !== kind) throw new Error('Unexpected file type');
  const key = await deriveKey(password, fromB64(j.salt));
  const plain = await openBytes(key, fromB64(j.iv), fromB64(j.ct));
  return JSON.parse(await inflate(new Uint8Array(plain))) as T;
}
