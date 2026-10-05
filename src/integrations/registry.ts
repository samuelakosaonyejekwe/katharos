// One place that knows every integration: what it does, how it is wired,
// whether it is ready, and how to test it from the browser.
import { settings } from '../core/settings';
import { aiAvailable, aiPing } from './ai';
import { fetchWithTimeout, gateway, gatewayConfigured } from './http';
import { canSendEmail, canSendWhatsApp, emailDirect, whatsappDirect } from './messaging';
import { activeLicence } from '../core/licence';
import { publicConfig } from '../core/config';
import { ocrPackCached } from './ocr';
import { refreshFeed, type FeedId } from './feeds';

export type IntegrationState = 'ready' | 'partial' | 'off' | 'error';

export interface Integration {
  id: string;
  name: string;
  layer: string;
  purpose: string;
  wiring: string;
  dataLocation: string;
  state: () => Promise<{ state: IntegrationState; detail: string }>;
  test?: () => Promise<string>;
}

interface Health {
  ok: boolean;
  region?: string;
  version?: string;
  connectors: Record<string, boolean>;
}

let healthCache: { at: number; h: Health | null; err: string | null } | null = null;

export async function gatewayHealth(force = false): Promise<{ h: Health | null; err: string | null }> {
  if (!gatewayConfigured()) return { h: null, err: 'not configured' };
  if (!force && healthCache && Date.now() - healthCache.at < 60_000) return healthCache;
  try {
    const h = await gateway<Health>('/v1/health', undefined, { timeoutMs: 10000 });
    healthCache = { at: Date.now(), h, err: null };
  } catch (e) {
    healthCache = { at: Date.now(), h: null, err: (e as Error).message };
  }
  return healthCache;
}

const conn = async (key: string): Promise<{ state: IntegrationState; detail: string }> => {
  const { h, err } = await gatewayHealth();
  if (!h) return { state: gatewayConfigured() ? 'error' : 'off', detail: gatewayConfigured() ? `Gateway unreachable: ${err}` : 'Needs the gateway' };
  return h.connectors[key] ? { state: 'ready', detail: `Configured on gateway (${h.region ?? 'EU'})` } : { state: 'off', detail: 'Not configured on the gateway' };
};

const feedTest = (id: FeedId) => async () => {
  const s = await refreshFeed(id, true);
  if (!s.data) throw new Error(s.error ?? 'no data');
  return `OK — ${s.source}`;
};

export const INTEGRATIONS: Integration[] = [
  {
    id: 'ai',
    name: 'AI model — Claude on Amazon Bedrock (EU)',
    layer: 'AI and document reading',
    purpose: 'Second, independent reading of every document; plain-language explanations; draft answers for the lawyer. Falls back to a second model on outage or refusal.',
    wiring: 'This browser → your own Amazon Bedrock account in an EU region (your API key, billed to you by AWS)',
    dataLocation: 'EU (your AWS region)',
    state: async () => {
      const s = settings();
      if (s.aiMode === 'off') return { state: 'off', detail: 'Off — rules and on-device reading still run' };
      if (!aiAvailable()) return { state: 'error', detail: s.aiMode === 'bedrock' ? 'Add your Bedrock API key' : s.aiMode === 'gateway' ? 'Gateway not connected' : 'No API key' };
      const where = { bedrock: `Bedrock ${s.bedrockRegion}`, gateway: 'Via your gateway', direct: 'Anthropic API (outside the EU)' }[s.aiMode];
      return { state: 'ready', detail: `${where} · ${s.aiModel} → ${s.aiBackupModel}` };
    },
    test: aiPing,
  },
  {
    id: 'pdf',
    name: 'PDF text layer reader',
    layer: 'AI and document reading',
    purpose: 'Reads digital certificates downloaded from the Land Registry portal exactly, line by line, for source-linked findings.',
    wiring: 'Built into the app; runs on this device',
    dataLocation: 'This device only',
    state: async () => ({ state: 'ready', detail: 'Built in' }),
  },
  {
    id: 'ocr-local',
    name: 'On-device Greek OCR',
    layer: 'AI and document reading',
    purpose: 'Reads scanned Greek and English pages on this device, free and in airplane mode. Never claims to read handwriting.',
    wiring: 'Built into the app (Greek + English language data), cached for offline use',
    dataLocation: 'This device only',
    state: async () => ((await ocrPackCached()) ? { state: 'ready', detail: 'Cached for offline use' } : { state: 'partial', detail: 'Downloads on first use (≈16 MB) — or cache it now below' }),
  },
  {
    id: 'azure',
    name: 'Azure AI Document Intelligence (EU)',
    layer: 'AI and document reading',
    purpose: 'Cloud OCR for printed Greek, with handwriting detection that routes pages to a person.',
    wiring: 'This browser → your own Azure resource in an EU region (your key, billed to you by Microsoft)',
    dataLocation: 'EU region of your Azure resource',
    state: async () => {
      const s = settings();
      if (s.ocrMode === 'azure-direct') return s.azureEndpoint && s.azureKey ? { state: 'ready', detail: 'Connected from this browser' } : { state: 'error', detail: 'Endpoint or key missing' };
      if (s.ocrMode === 'gateway') return conn('azure');
      return { state: 'off', detail: 'Using on-device OCR' };
    },
    test: async () => {
      const s = settings();
      if (!s.azureEndpoint || !s.azureKey) throw new Error('Add the endpoint and key first');
      const res = await fetchWithTimeout(`${s.azureEndpoint.replace(/\/+$/, '')}/documentintelligence/info?api-version=2024-11-30`, { headers: { 'Ocp-Apim-Subscription-Key': s.azureKey }, timeoutMs: 15000 });
      if (!res.ok) throw new Error(`Azure: HTTP ${res.status}`);
      return 'OK — Azure resource reachable';
    },
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business Platform',
    layer: 'Trust and messaging',
    purpose: 'Neutral, opt-in status messages to buyers ("a new update is in your portal"). No legal content.',
    wiring: 'This browser → your own WhatsApp Business account (Meta Cloud API) · or the wa.me link on this device, free',
    dataLocation: 'Meta (status text only)',
    state: async () => (whatsappDirect() ? { state: 'ready', detail: 'Your WhatsApp Business account' } : canSendWhatsApp() ? conn('whatsapp') : { state: 'partial', detail: 'Device links (wa.me) — always available, free' }),
    test: async () => {
      const s = settings();
      if (!whatsappDirect()) throw new Error('Add the access token and phone number ID first');
      const res = await fetchWithTimeout(`https://graph.facebook.com/v21.0/${encodeURIComponent(s.waPhoneId)}?fields=display_phone_number,verified_name`, { headers: { authorization: `Bearer ${s.waToken}` }, timeoutMs: 15000 });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      return `OK — ${j.verified_name ?? ''} ${j.display_phone_number ?? ''}`.trim();
    },
  },
  {
    id: 'email',
    name: 'Email (Brevo, EU)',
    layer: 'Trust and messaging',
    purpose: 'Status emails with the buyer’s portal link.',
    wiring: 'This browser → your own Brevo account (free tier available) · or your email app on this device, free',
    dataLocation: 'EU',
    state: async () => (emailDirect() ? { state: 'ready', detail: 'Your Brevo account' } : canSendEmail() ? conn('email') : { state: 'partial', detail: 'Device email app (mailto) — always available, free' }),
    test: async () => {
      const s = settings();
      if (!emailDirect()) throw new Error('Add the API key and sender address first');
      const res = await fetchWithTimeout('https://api.brevo.com/v3/account', { headers: { 'api-key': s.brevoKey, accept: 'application/json' }, timeoutMs: 15000 });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`);
      return `OK — ${j.companyName ?? j.email ?? 'account reachable'}`;
    },
  },
  {
    id: 'jcc',
    name: 'JCC qualified e-signature',
    layer: 'Trust and messaging',
    purpose: 'The advocate signs the issued report with a qualified electronic signature (eIDAS). The signed PDF is stored and fingerprinted.',
    wiring: 'Print report to PDF → sign in JCC Sign → upload the signed PDF to the matter',
    dataLocation: 'JCC (Cyprus)',
    state: async () => ({ state: 'partial', detail: 'Manual signing flow — no public API was found' }),
  },
  {
    id: 'licence',
    name: 'Licence and billing',
    layer: 'Sign-in',
    purpose: 'Professional licences are bought and renewed through the licence store, which also handles EU VAT. Katharos checks the licence from this browser.',
    wiring: 'Licence store (Lemon Squeezy) licence API, called from this browser; operator-issued keys are checked on the device',
    dataLocation: 'Licence key and device name only',
    state: async () => {
      const l = await activeLicence();
      const cfg = await publicConfig();
      if (!l) return { state: 'error', detail: 'No licence on this device' };
      return { state: 'ready', detail: `${l.holder || '—'} · ${l.kind === 'store' ? 'store licence' : 'operator licence'}${l.exp ? ` · until ${l.exp}` : ''}${cfg.lemonsqueezy.storeId === null && l.kind === 'store' ? ' · store not configured' : ''}` };
    },
  },
  {
    id: 'opensanctions',
    name: 'OpenSanctions screening (optional)',
    layer: 'Compliance',
    purpose: 'Screens sellers and buyers against sanctions and PEP lists; leads for the compliance officer.',
    wiring: 'Through your own gateway (the OpenSanctions API does not accept direct browser calls)',
    dataLocation: 'OpenSanctions API (names only)',
    state: async () => (gatewayConfigured() ? conn('screening') : { state: 'off', detail: 'Optional — needs your own gateway' }),
  },
  {
    id: 'gateway',
    name: 'Your own gateway (optional)',
    layer: 'Application services',
    purpose: 'Only if your IT team prefers to hold integration keys on a server it runs in the EU instead of in this encrypted vault. Not needed for any core feature.',
    wiring: 'This browser → your gateway (HTTPS, bearer token) → providers; automatic failover to a backup gateway',
    dataLocation: 'EU (your account)',
    state: async () => {
      if (!gatewayConfigured()) return { state: 'off', detail: 'Not used — integrations connect directly from this browser' };
      const { h, err } = await gatewayHealth();
      return h ? { state: 'ready', detail: `Online · ${h.region ?? 'EU'} · v${h.version ?? '?'}${settings().gatewayBackupUrl ? ' · backup configured' : ''}` } : { state: 'error', detail: err ?? 'unreachable' };
    },
    test: async () => {
      const { h, err } = await gatewayHealth(true);
      if (!h) throw new Error(err ?? 'unreachable');
      return `OK — connectors: ${Object.entries(h.connectors).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none yet'}`;
    },
  },
  {
    id: 'feed-fx',
    name: 'ECB exchange rates',
    layer: 'Live data',
    purpose: 'Euro rates for buyer currencies (USD, GBP, ILS, RUB, UAH…).',
    wiring: 'Each browser → Frankfurter (ECB) → ECB data API → last good copy',
    dataLocation: 'Public data',
    state: async () => ({ state: 'ready', detail: 'Live, multi-source' }),
    test: feedTest('fx'),
  },
  {
    id: 'feed-hpi',
    name: 'Eurostat house price index (Cyprus)',
    layer: 'Live data',
    purpose: 'Official quarterly residential price index and annual change.',
    wiring: 'Each browser → Eurostat dissemination API → last good copy',
    dataLocation: 'Public data',
    state: async () => ({ state: 'ready', detail: 'Live' }),
    test: feedTest('hpi'),
  },
  {
    id: 'feed-news',
    name: 'Cyprus property news',
    layer: 'Live data',
    purpose: 'Cyprus Mail property section and Google News coverage of title deeds, Land Registry and real estate.',
    wiring: 'Each browser → rss2json → direct RSS via proxy → last good copy',
    dataLocation: 'Public data',
    state: async () => ({ state: 'ready', detail: 'Live, multi-source' }),
    test: feedTest('news'),
  },
  {
    id: 'feed-holidays',
    name: 'Cyprus public holidays',
    layer: 'Live data',
    purpose: 'Cross-checks the built-in working-day calendar (computed offline, incl. Orthodox Easter).',
    wiring: 'Built-in calculation + Nager.Date live check',
    dataLocation: 'Public data',
    state: async () => ({ state: 'ready', detail: 'Built in + live check' }),
    test: feedTest('holidays'),
  },
  {
    id: 'land-registry',
    name: 'Land Registry (DLS) portal',
    layer: 'People and channels',
    purpose: 'Source of search certificates. There is no public API, so the lawyer downloads the certificate with their verified account and uploads it here.',
    wiring: 'Lawyer’s verified DLS portal account → upload',
    dataLocation: 'Cyprus',
    state: async () => ({ state: 'partial', detail: 'Manual download by the lawyer (no API exists)' }),
  },
];
