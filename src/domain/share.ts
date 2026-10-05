// Buyer pack: the issued report, timeline and key dates, encrypted in
// the browser. The link carries the data in its #fragment, which browsers never send to any
// server — so the buyer portal needs no backend and works offline once opened.
import { deflate, deriveKey, fromB64Url, importShareKey, inflate, newShareKey, openBytes, randomBytes, sealBytes, toB64Url } from '../core/crypto';
import { settings } from '../core/settings';
import { buildReport, reportLangs } from './report';
import type { Lang, Matter, MatterStatus, Severity } from './types';

export interface BuyerPack {
  v: 1;
  matterRef: string;
  firm: string;
  advocate: { name: string; email: string; phone: string };
  buyerName: string;
  lang: Lang;
  langs: Lang[];
  status: MatterStatus;
  issuedAt: string | null;
  fingerprint: string | null;
  aiAssisted: boolean;
  property: string;
  certificateDate: string | null;
  findings: { severity: Severity; text: Partial<Record<Lang, string>>; note: string | null }[];
  deadlines: { label: Partial<Record<Lang, string>>; due: string; done: boolean }[];
  answers: { q: string; a: string; at: string }[];
  createdAt: string;
}

export function buildPack(m: Matter): BuyerPack {
  const s = settings();
  const langs = reportLangs(m);
  const per = Object.fromEntries(langs.map((l) => [l, buildReport(m, l)])) as Record<Lang, ReturnType<typeof buildReport>>;
  const first = per[langs[0]];
  return {
    v: 1,
    matterRef: m.matterRef,
    firm: s.firmName,
    advocate: { name: m.report?.advocate ?? s.advocateName, email: s.advocateEmail, phone: s.advocatePhone },
    buyerName: m.buyer.name.split(' ')[0] ?? '',
    lang: m.buyer.lang,
    langs,
    status: m.status,
    issuedAt: m.report?.issuedAt ?? null,
    fingerprint: m.report?.fingerprint ?? null,
    aiAssisted: m.report?.aiAssisted ?? false,
    property: first.property,
    certificateDate: first.certificateDate,
    findings: first.lines.map((line, i) => ({
      severity: line.severity,
      note: line.note,
      text: Object.fromEntries(langs.map((l) => [l, per[l].lines[i].text])),
    })),
    deadlines: first.deadlines.map((d, i) => ({ due: d.due, done: d.done, label: Object.fromEntries(langs.map((l) => [l, per[l].deadlines[i].label])) })),
    answers: m.questions.filter((q) => q.answer).map((q) => ({ q: q.text, a: q.answer!, at: q.answeredAt! })),
    createdAt: new Date().toISOString(),
  };
}

/** Link format: #/b/<payload>.<key>   or, with a PIN: #/b/<payload>.p<salt> (PIN shared separately). */
export async function packLink(pack: BuyerPack, pin?: string): Promise<{ url: string; length: number }> {
  const data = await deflate(JSON.stringify(pack));
  let suffix: string;
  let key: CryptoKey;
  if (pin) {
    const salt = randomBytes(16);
    key = await deriveKey(pin, salt, 310_000);
    suffix = `p${toB64Url(salt)}`;
  } else {
    const k = await newShareKey();
    key = k.key;
    suffix = toB64Url(k.raw);
  }
  const { iv, ct } = await sealBytes(key, data);
  const blob = new Uint8Array(iv.length + ct.byteLength);
  blob.set(iv, 0);
  blob.set(new Uint8Array(ct), iv.length);
  const url = `${location.origin}${location.pathname}#/b/${toB64Url(blob)}.${suffix}`;
  return { url, length: url.length };
}

export function needsPin(token: string): boolean {
  return token.split('.')[1]?.startsWith('p') ?? false;
}

export async function openPack(token: string, pin?: string): Promise<BuyerPack> {
  const [payload, suffix] = token.split('.');
  if (!payload || !suffix) throw new Error('Incomplete link');
  const bytes = fromB64Url(payload);
  const key = suffix.startsWith('p') ? await deriveKey(pin ?? '', fromB64Url(suffix.slice(1)), 310_000) : await importShareKey(fromB64Url(suffix));
  const plain = await openBytes(key, bytes.slice(0, 12), bytes.slice(12));
  const pack = JSON.parse(await inflate(new Uint8Array(plain))) as BuyerPack;
  if (pack.v !== 1) throw new Error('Unsupported pack version');
  return pack;
}
