// Firm settings and integration credentials. Stored sealed inside the vault — keys never sit
// in plain browser storage, and never in the code or the repository.
import { sealed } from './db';

export type AiMode = 'off' | 'gateway' | 'direct';
export type OcrMode = 'local' | 'gateway' | 'azure-direct';

export interface Settings {
  firmName: string;
  advocateName: string;
  advocateEmail: string;
  advocatePhone: string; // international format, for buyer WhatsApp/email links
  matterPrefix: string;
  autoLockMinutes: number;
  // Gateway (EU-hosted, deployed by the firm — see gateway/README.md)
  gatewayUrl: string;
  gatewayToken: string;
  gatewayBackupUrl: string; // second gateway in another region/provider (redundancy)
  // AI model
  aiMode: AiMode;
  aiModel: string;
  aiBackupModel: string;
  anthropicKey: string; // only for "direct" mode (processing outside the EU; see warning in the UI)
  // OCR
  ocrMode: OcrMode;
  azureEndpoint: string;
  azureKey: string;
  // Screening (optional)
  openSanctionsKey: string;
  // Messaging
  whatsappEnabled: boolean;
  emailViaGateway: boolean;
  // Rulebook
  legalPanel: string;
}

export const DEFAULTS: Settings = {
  firmName: '',
  advocateName: '',
  advocateEmail: '',
  advocatePhone: '',
  matterPrefix: '',
  autoLockMinutes: 15,
  gatewayUrl: '',
  gatewayToken: '',
  gatewayBackupUrl: '',
  aiMode: 'off',
  aiModel: 'claude-opus-5-5',
  aiBackupModel: 'claude-sonnet-5-5',
  anthropicKey: '',
  ocrMode: 'local',
  azureEndpoint: '',
  azureKey: '',
  openSanctionsKey: '',
  whatsappEnabled: false,
  emailViaGateway: false,
  legalPanel: '',
};

let cached: Settings | null = null;
const listeners = new Set<(s: Settings) => void>();

export async function loadSettings(): Promise<Settings> {
  const s = await sealed.get<Partial<Settings>>('secrets', 'settings');
  cached = { ...DEFAULTS, ...(s ?? {}) };
  return cached;
}

export function settings(): Settings {
  return cached ?? DEFAULTS;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  cached = { ...settings(), ...patch };
  await sealed.put('secrets', 'settings', cached);
  listeners.forEach((l) => l(cached!));
  return cached;
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function forgetSettings(): void {
  cached = null;
}
