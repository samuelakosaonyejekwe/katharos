// Buyer notifications: only neutral status messages leave the platform —
// legal content stays in the portal. Two routes: the firm's gateway (WhatsApp Cloud API template,
// Amazon SES email), or a device link (wa.me / mailto) the lawyer taps — which needs no API at all.
// Gateway messages queue in an encrypted outbox when offline and are sent when the device reconnects.
import { randomId } from '../core/crypto';
import { sealed, vault } from '../core/db';
import { settings } from '../core/settings';
import type { Lang } from '../domain/types';
import { ui } from '../i18n/messages';
import { gateway, gatewayConfigured } from './http';

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

async function deliver(item: OutboxItem): Promise<void> {
  if (item.channel === 'whatsapp') {
    await gateway('/v1/notify/whatsapp', { to: item.to, lang: item.lang, template: 'katharos_status_update' });
  } else {
    const body = item.link ? `${NEUTRAL[item.lang]}\n\n${item.link}` : NEUTRAL[item.lang];
    await gateway('/v1/notify/email', { to: item.to, subject: SUBJECT[item.lang], text: body });
  }
}

/** Sends now if possible, otherwise queues for background delivery. */
export async function notifyBuyer(channel: 'whatsapp' | 'email', to: string, lang: Lang, link?: string): Promise<'sent' | 'queued'> {
  if (!gatewayConfigured()) throw new Error('Gateway messaging is not configured — use the device link instead.');
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
  if (!vault.isUnlocked() || !navigator.onLine || !gatewayConfigured()) return 0;
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
  const s = settings();
  if (!gatewayConfigured()) return 'Device links (WhatsApp / email apps)';
  return [s.whatsappEnabled && 'WhatsApp Cloud API', s.emailViaGateway && 'Amazon SES email'].filter(Boolean).join(' + ') || 'Device links';
}
