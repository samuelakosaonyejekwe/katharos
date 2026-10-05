// Append-only, hash-chained audit trail: never updated, only added to.
// Each event's hash covers the previous hash, so any edit or deletion breaks the chain.
import { sha256Hex } from '../core/crypto';
import type { AuditEvent, Matter } from './types';

const GENESIS = '0'.repeat(64);

function canonical(e: Omit<AuditEvent, 'hash'>): string {
  return JSON.stringify([e.seq, e.at, e.actor, e.kind, e.detail, e.prevHash]);
}

export async function appendEvent(m: Matter, actor: string, kind: string, detail: Record<string, unknown> = {}): Promise<AuditEvent> {
  const last = m.events.at(-1);
  const base = { seq: (last?.seq ?? 0) + 1, at: new Date().toISOString(), actor, kind, detail, prevHash: last?.hash ?? GENESIS };
  const event: AuditEvent = { ...base, hash: await sha256Hex(canonical(base)) };
  m.events.push(event);
  return event;
}

export async function verifyChain(events: AuditEvent[]): Promise<{ ok: boolean; brokenAt: number | null }> {
  let prev = GENESIS;
  for (const e of events) {
    if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq };
    const { hash, ...rest } = e;
    if ((await sha256Hex(canonical(rest))) !== hash) return { ok: false, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true, brokenAt: null };
}
