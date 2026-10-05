// Public runtime settings (public/config.json): checkout links and the licence store. The file is
// fetched fresh when online and cached for offline use, so the operator can switch payments on
// by editing one file — no rebuild, no server.
export type Role = 'lawyer' | 'developer' | 'bank';

export interface PublicConfig {
  checkout: Partial<Record<Role, string>>;
  lemonsqueezy: { storeId: number | null; variants: Record<string, Role> };
  contact: string;
}

const EMPTY: PublicConfig = { checkout: {}, lemonsqueezy: { storeId: null, variants: {} }, contact: '' };
let cached: PublicConfig | null = null;

export async function publicConfig(): Promise<PublicConfig> {
  if (cached) return cached;
  try {
    const res = await fetch('./config.json', { cache: 'no-cache' });
    const j = (await res.json()) as Partial<PublicConfig>;
    cached = { ...EMPTY, ...j, checkout: { ...j.checkout }, lemonsqueezy: { ...EMPTY.lemonsqueezy, ...j.lemonsqueezy } };
  } catch {
    cached = EMPTY;
  }
  return cached;
}
