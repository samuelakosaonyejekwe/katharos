// One place that knows every integration: what it does, how it is wired,
// whether it is ready, and how to test it from the browser.
import { settings } from '../core/settings';
import { aiAvailable, aiPing } from './ai';
import { gateway, gatewayConfigured } from './http';
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
    id: 'gateway',
    name: 'Katharos gateway (EU)',
    layer: 'Application services',
    purpose: 'Holds the firm’s secret keys and calls AI, OCR, WhatsApp, email and screening on the browser’s behalf. Runs in an EU region you control — never on a personal machine.',
    wiring: 'Browser → HTTPS (bearer token) → AWS Lambda / any Node host in the EU; automatic failover to a backup gateway URL',
    dataLocation: 'EU (Milan / Frankfurt)',
    state: async () => {
      if (!gatewayConfigured()) return { state: 'off', detail: 'Not connected — optional; everything core works without it' };
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
    id: 'ai',
    name: 'AI model — Claude via Amazon Bedrock (EU)',
    layer: 'AI and document reading',
    purpose: 'Second, independent reading of every document; plain-language explanations; translations; draft answers for the lawyer. Backup model on outage or refusal.',
    wiring: 'Gateway → Bedrock (EU region) · or direct from this browser with the firm’s Anthropic key (processing outside the EU — warned)',
    dataLocation: 'EU via gateway · US/global if direct',
    state: async () => {
      const s = settings();
      if (s.aiMode === 'off') return { state: 'off', detail: 'Off — rules and on-device reading still run' };
      if (!aiAvailable()) return { state: 'error', detail: s.aiMode === 'gateway' ? 'Gateway not connected' : 'No API key' };
      return { state: 'ready', detail: `${s.aiMode === 'gateway' ? 'Via EU gateway' : 'Direct (non-EU processing)'} · ${s.aiModel} → ${s.aiBackupModel}` };
    },
    test: aiPing,
  },
  {
    id: 'ocr-local',
    name: 'On-device Greek OCR',
    layer: 'AI and document reading',
    purpose: 'Reads scanned Greek and English pages on this device — works in airplane mode. Never claims to read handwriting.',
    wiring: 'Tesseract (self-hosted engine + Greek/English language data), cached for offline use',
    dataLocation: 'This device only',
    state: async () => ((await ocrPackCached()) ? { state: 'ready', detail: 'Cached for offline use' } : { state: 'partial', detail: 'Downloads on first use (≈16 MB) — or cache it now in Settings' }),
  },
  {
    id: 'pdf',
    name: 'PDF text layer reader',
    layer: 'AI and document reading',
    purpose: 'Reads digital certificates downloaded from the Land Registry portal exactly, line by line, for source-linked findings.',
    wiring: 'pdf.js, bundled; runs in a worker',
    dataLocation: 'This device only',
    state: async () => ({ state: 'ready', detail: 'Built in' }),
  },
  {
    id: 'azure',
    name: 'Azure AI Document Intelligence (EU)',
    layer: 'AI and document reading',
    purpose: 'Cloud OCR for printed Greek, with handwriting detection to route pages to a person.',
    wiring: 'Gateway → Azure (EU region) · or direct with an Azure key',
    dataLocation: 'EU region of your Azure resource',
    state: async () => {
      const s = settings();
      if (s.ocrMode === 'azure-direct') return s.azureEndpoint && s.azureKey ? { state: 'ready', detail: 'Direct from browser' } : { state: 'error', detail: 'Endpoint or key missing' };
      if (s.ocrMode === 'gateway') return conn('azure');
      return { state: 'off', detail: 'Using on-device OCR' };
    },
  },
  {
    id: 'google',
    name: 'Google Document AI (backup OCR)',
    layer: 'AI and document reading',
    purpose: 'Keeps cloud OCR working if Azure is unavailable.',
    wiring: 'Gateway → Google Document AI (EU location)',
    dataLocation: 'EU',
    state: () => conn('google'),
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business Platform',
    layer: 'Trust and messaging',
    purpose: 'Neutral, opt-in status messages to buyers ("a new update is in your portal"). No legal content.',
    wiring: 'Gateway → WhatsApp Cloud API template · or wa.me link from this device',
    dataLocation: 'Meta (status text only)',
    state: async () => (settings().whatsappEnabled ? conn('whatsapp') : { state: 'partial', detail: 'Device links (wa.me) — always available' }),
  },
  {
    id: 'email',
    name: 'Email (Amazon SES)',
    layer: 'Trust and messaging',
    purpose: 'Status emails with the buyer’s portal link.',
    wiring: 'Gateway → Amazon SES (EU) · or mailto: from this device',
    dataLocation: 'EU',
    state: async () => (settings().emailViaGateway ? conn('email') : { state: 'partial', detail: 'Device email app (mailto) — always available' }),
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
    id: 'opensanctions',
    name: 'OpenSanctions screening (optional)',
    layer: 'Compliance',
    purpose: 'Screens sellers and buyers against sanctions and PEP lists; leads for the compliance officer.',
    wiring: 'Direct from browser with the firm’s key · or via gateway',
    dataLocation: 'OpenSanctions API (names only)',
    state: async () => (settings().openSanctionsKey ? { state: 'ready', detail: 'Direct key set' } : gatewayConfigured() ? conn('screening') : { state: 'off', detail: 'Optional' }),
  },
  {
    id: 'feed-fx',
    name: 'ECB exchange rates',
    layer: 'Live data',
    purpose: 'Euro rates for buyer currencies (USD, GBP, ILS, RUB, UAH…).',
    wiring: 'Each browser → Frankfurter (ECB) → ECB data API → gateway mirror → last good copy',
    dataLocation: 'Public data',
    state: async () => ({ state: 'ready', detail: 'Live, multi-source' }),
    test: feedTest('fx'),
  },
  {
    id: 'feed-hpi',
    name: 'Eurostat house price index (Cyprus)',
    layer: 'Live data',
    purpose: 'Official quarterly residential price index and annual change.',
    wiring: 'Each browser → Eurostat dissemination API → gateway mirror → last good copy',
    dataLocation: 'Public data',
    state: async () => ({ state: 'ready', detail: 'Live' }),
    test: feedTest('hpi'),
  },
  {
    id: 'feed-news',
    name: 'Cyprus property news',
    layer: 'Live data',
    purpose: 'Cyprus Mail property section and Google News coverage of title deeds, Land Registry and real estate.',
    wiring: 'Each browser → rss2json → direct RSS via proxy → gateway mirror → last good copy',
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
