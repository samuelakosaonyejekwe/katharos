// Buyer notifications: only neutral status messages leave the platform —
// legal content stays in the portal. Two routes: the firm's gateway (WhatsApp Cloud API template,
// Amazon SES email), or a device link (wa.me / mailto) the lawyer taps — which needs no API at all.
// Gateway messages queue in an encrypted outbox when offline and are sent when the device reconnects.
import { randomId } from '../core/crypto';
import { sealed, vault } from '../core/db';
import { settings } from '../core/settings';
import type { Lang } from '../domain/types';
import { ui } from '../i18n/messages';
import { fetchWithTimeout, gateway, gatewayConfigured } from './http';

export const NEUTRAL = new Proxy({} as Record<Lang, string>, { get: (_, l) => ui('notify', l as Lang) });
export const SUBJECT = new Proxy({} as Record<Lang, string>, { get: (_, l) => ui('notifySubject', l as Lang) });

export function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(text)}`;
}

export function mailLink(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

interface OutboxItem {
  id: string;
  channel: 'whatsapp' | 'email';
  to: string;
  lang: Lang;
  link?: string;
  createdAt: string;
  attempts: number;
}

async function outbox(): Promise<OutboxItem[]> {
  return (await sealed.get<OutboxItem[]>('secrets', 'outbox')) ?? [];
}

async function setOutbox(items: OutboxItem[]): Promise<void> {
  await sealed.put('secrets', 'outbox', items);
}

const WA_LANG: Record<Lang, string> = { en: 'en', el: 'el', he: 'he', ru: 'ru', ar: 'ar', uk: 'uk', tr: 'tr', fr: 'fr', zh: 'zh_CN', pt: 'pt_PT', es: 'es', it: 'it' };

export function whatsappDirect(): boolean {
  const s = settings();
  return Boolean(s.waToken && s.waPhoneId);
}

export function emailDirect(): boolean {
  const s = settings();
  return Boolean(s.brevoKey && s.brevoSender);
}

export function canSendWhatsApp(): boolean {
  return whatsappDirect() || (gatewayConfigured() && settings().whatsappEnabled);
}

export function canSendEmail(): boolean {
  return emailDirect() || (gatewayConfigured() && settings().emailViaGateway);
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<void> {
  const res = await fetchWithTimeout(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), timeoutMs: 20000 });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function deliver(item: OutboxItem): Promise<void> {
  const s = settings();
  if (item.channel === 'whatsapp') {
    if (whatsappDirect()) {
      // The organisation's own WhatsApp Business account (Meta Cloud API), called from this browser.
      await postJson(`https://graph.facebook.com/v21.0/${encodeURIComponent(s.waPhoneId)}/messages`, { authorization: `Bearer ${s.waToken}` }, {
        messaging_product: 'whatsapp',
        to: item.to.replace(/[^\d]/g, ''),
        type: 'template',
        template: { name: s.waTemplate || 'katharos_status_update', language: { code: WA_LANG[item.lang] } },
      });
    } else await gateway('/v1/notify/whatsapp', { to: item.to, lang: item.lang, template: s.waTemplate || 'katharos_status_update' });
    return;
  }
  const body = item.link ? `${NEUTRAL[item.lang]}\n\n${item.link}` : NEUTRAL[item.lang];
  if (emailDirect()) {
    // The organisation's own Brevo account (EU), called from this browser.
    await postJson('https://api.brevo.com/v3/smtp/email', { 'api-key': s.brevoKey, accept: 'application/json' }, {
      sender: { email: s.brevoSender, name: s.brevoSenderName || s.firmName || 'Katharos' },
      to: [{ email: item.to }],
      subject: SUBJECT[item.lang],
      textContent: body,
    });
  } else await gateway('/v1/notify/email', { to: item.to, subject: SUBJECT[item.lang], text: body });
}

/** Sends now if possible, otherwise queues for background delivery. */
export async function notifyBuyer(channel: 'whatsapp' | 'email', to: string, lang: Lang, link?: string): Promise<'sent' | 'queued'> {
  if (channel === 'whatsapp' ? !canSendWhatsApp() : !canSendEmail()) throw new Error('This channel is not connected — use the device link instead.');
  const item: OutboxItem = { id: randomId('o_'), channel, to, lang, link, createdAt: new Date().toISOString(), attempts: 0 };
  if (navigator.onLine) {
    try {
      await deliver(item);
      return 'sent';
    } catch {
      /* fall through to queue */
    }
  }
  await setOutbox([...(await outbox()), item]);
  try {
    const reg = await navigator.serviceWorker?.ready;
    await (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } })?.sync?.register('katharos-outbox');
  } catch {
    /* background sync unsupported: flushed on the next "online" event */
  }
  return 'queued';
}

export async function flushOutbox(): Promise<number> {
  if (!vault.isUnlocked() || !navigator.onLine || !(canSendEmail() || canSendWhatsApp())) return 0;
  const items = await outbox();
  const left: OutboxItem[] = [];
  let sent = 0;
  for (const it of items) {
    try {
      await deliver(it);
      sent++;
    } catch {
      if (it.attempts < 10) left.push({ ...it, attempts: it.attempts + 1 });
    }
  }
  await setOutbox(left);
  return sent;
}

export async function outboxSize(): Promise<number> {
  return vault.isUnlocked() ? (await outbox()).length : 0;
}

export function messagingSummary(): string {
  return [canSendWhatsApp() && 'WhatsApp Cloud API', canSendEmail() && (emailDirect() ? 'Brevo email' : 'Amazon SES email')].filter(Boolean).join(' + ') || 'Device links (WhatsApp / email apps)';
}
