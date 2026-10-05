// Deterministic reader for Land Registry search certificates and sale contracts (Greek or English).
// It is one of the two independent readings; the other is OCR or the AI model.
// No specimen certificate has been available, so patterns are deliberately broad
// and anything uncertain lowers confidence and is routed to a person.
//
// Matching runs on an accent-folded copy of each line (ά→α, Ή→Η …) that has exactly the same length
// as the original, so values are always cut from the original text with their accents intact.
import { findDate } from '../core/dates';
import { randomId } from '../core/crypto';
import { normName } from './rules';
import type { CertKind, Contract, Encumbrance, EncumbranceKind, Owner, PageText, PropertyId, SourceRef } from './types';
import { emptyContract, emptyProperty } from './types';

export interface CertDraft {
  kind: CertKind;
  issuedOn: string | null;
  property: PropertyId;
  owners: Owner[];
  encumbrances: Encumbrance[];
  separateTitle: boolean | null;
  handwrittenRegions: number;
  confidence: number;
}

/** Removes accents one UTF-16 unit at a time, so indices line up with the original string. */
export function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const u = s[i];
    out += u.charCodeAt(0) < 0x80 ? u : (u.normalize('NFD')[0] ?? u);
  }
  return out;
}

interface Line {
  text: string; // original
  f: string; // folded (same length)
  page: number;
  line: number;
}

function flatten(pages: PageText[]): Line[] {
  return pages
    .flatMap((p) => p.lines.map((raw, i) => ({ text: raw.replace(/\s+/g, ' ').trim(), page: p.page, line: i + 1 })))
    .filter((l) => l.text)
    .map((l) => ({ ...l, f: fold(l.text) }));
}

/** Runs a regex on the folded text and returns group 1 cut from the original text. */
function grab(l: Line, rx: RegExp, group = 1): string | null {
  const m = l.f.match(rx);
  if (!m || m[group] === undefined || m.index === undefined) return null;
  const start = m.index + m[0].indexOf(m[group]);
  return l.text.slice(start, start + m[group].length).trim();
}

const DISTRICTS: [RegExp, string][] = [
  [/λευκωσ|nicosia|lefkosia/i, 'Nicosia'],
  [/λεμεσ|limassol|lemesos/i, 'Limassol'],
  [/λαρνακ|larnaca|larnaka/i, 'Larnaca'],
  [/παφο|paphos|pafos/i, 'Paphos'],
  [/αμμοχωστ|famagusta|ammochostos/i, 'Famagusta'],
  [/κερυνει|kyrenia|keryneia/i, 'Kyrenia'],
];

const KIND_RX: [RegExp, EncumbranceKind][] = [
  [/υποθηκ|mortgage/i, 'mortgage'],
  [/(?:^|[\s(])μεμο|(?:^|[\s(])memo\b|memorandum/i, 'memo'],
  [/απαγορευσ|απαγορευτικ|prohibition/i, 'prohibition'],
  [/πωλητηρι|κατατεθ\p{L}* συμβασ|sale contract|contract of sale|deposited contract|specific performance/iu, 'deposited_contract'],
  [/μισθωσ|(?:^|\s)lease\b/i, 'lease'],
  [/δουλεια|δικαιωμα διοδου|easement|right of way/i, 'easement'],
];

// Words that make a line a property/label line rather than an owner line.
const NOT_OWNER = /φυλλο|σχεδιο|τεμαχιο|sheet|(?:^|\s)plan\b|plot|parcel|εγγραφ|registration|τιτλ|title|περιγραφ|description|ημερομην|(?:^|\s)date\b|επαρχ|district|δημος|κοινοτητα|municipality|village|εμβαδ|area|πιστοποιητικ|certificate|τμημα|department|κτηματολογ|land registry|δημοκρατια|republic|σελιδα|page/i;

const SHEET_PLAN = /(?:φυλλο\s*\/\s*σχεδιο|sheet\s*\/\s*plan|φ\/σχ|s\/p)\s*[:.]?\s*(\d{1,3})\s*\/\s*([0-9A-Z.]{1,8})/i;
const LABEL: Record<'sheet' | 'plan' | 'parcel' | 'registrationNo' | 'titleNumber' | 'municipality', RegExp> = {
  sheet: /(?:φυλλο|sheet)\s*[:.]?\s*([0-9]{1,3}(?:[./][0-9A-Z]{1,6})?)/i,
  plan: /(?:σχεδιο|(?:^|\s)plan)\s*[:.]?\s*([0-9]{1,3}(?:[./][0-9A-Z]{1,6})?)/i,
  parcel: /(?:τεμαχιο|τεμ\.|plot|parcel)\s*(?:αρ\.?|no\.?)?\s*[:.]?\s*([0-9]{1,6})/i,
  registrationNo: /(?:αρ(?:ιθμος|\.)?\s*εγγραφης|registration\s*(?:no|number)\.?|reg\.?\s*no\.?)\s*[:.]?\s*([0-9A-Z][0-9A-Z/-]{0,20})/i,
  titleNumber: /(?:αρ(?:ιθμος|\.)?\s*τιτλου|title\s*(?:deed\s*)?(?:no|number)\.?)\s*[:.]?\s*([0-9A-Z][0-9A-Z/-]{0,20})/i,
  municipality: /(?:δημος|κοινοτητα|χωριο|municipality|community|village)\s*[:.]?\s*([^\s,;:]+(?:\s[^\s,;:]+)?)/i,
};

const ISSUED_RX = /(?:ημερομηνια(?:\s*εκδοσης)?|date\s*(?:of\s*issue)?|issued(?:\s*on)?|εκδοθηκε)\s*[:.]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2})/i;
const AMOUNT_RX = /(?:€|eur(?:o|os)?|ευρω)\s*([\d.,]{3,})|([\d.,]{3,})\s*(?:€|eur(?:o|os)?|ευρω)/i;
const SHARE_RX = /(?:^|[\s:(])(\d{1,4})\s*\/\s*(\d{1,4})(?=$|[\s),.;])/;
const ID_RX = /(?:α\.?\s?τ\.?|δ\.?\s?τ\.?|(?:^|\s)id(?:\s*(?:no|card))?|ταυτ\p{L}*|passport|διαβατ\p{L}*|he\s*no\.?|αρ\.?\s*εγγρ\.?\s*εταιρ\p{L}*)\s*[:.]?\s*([A-ZΑ-Ω]{0,3}\s?\d{4,10})/iu;
const HOLDER_RX = /(?:υπερ|in favou?r of|favou?r of|δανειστης|πιστωτης|creditor|lender|beneficiary|δικαιουχος)\s*[:.]?\s*(.+)/i;
const RELEASED_RX = /εξαλειφθ|εξαλειψη|ακυρωθ|released|discharged|cancell?ed|withdrawn/i;
const NONE_RX = /(?:καμια εγγραφ|δεν υπαρχουν (?:βαρη|εγγραφ)|ουδεν|no encumbrances|no entries|(?:^|\s)nil(?:$|\s)|none registered)/i;
const REF_RX = /(?:^|\s)(?:αρ(?:ιθμος|\.)?|no\.?|ref(?:erence)?\.?)\s*[:.]?\s*([A-ZΑ-Ω0-9][A-ZΑ-Ω0-9/-]{2,})/i;
const LABEL_WORDS = /(?:ημερομηνια|ημ\/νια|date|ποσο|amount|ref(?:erence)?|αρ(?:ιθμος|\.)?)\s*[:.]?(?=\s|$)/gi;

export function parseAmount(s: string): number | null {
  const m = fold(s).match(AMOUNT_RX);
  if (!m) return null;
  const raw = (m[1] ?? m[2]).replace(/[.,](?=\d{3}(?!\d))/g, '').replace(',', '.');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Strips labels, IDs, shares and punctuation from a name, working on the original text. */
function cleanName(original: string): string {
  let s = original;
  const cut = (rx: RegExp) => {
    const m = fold(s).match(rx);
    if (m && m.index !== undefined) s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
  };
  cut(ID_RX);
  cut(SHARE_RX);
  for (let i = 0; i < 4; i++) cut(/(?:ιδιοκτητ\p{L}*|εγγεγραμμεν\p{L}*|registered|owners?|δικαιουχ\p{L}*|μεριδιο|share|ονοματεπωνυμο|name)\s*[:.]?/iu);
  return s
    .replace(/[|•·;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-–,.\s]+|[-–,.\s]+$/g, '');
}

function ref(evidenceId: string, l: Line): SourceRef {
  return { evidenceId, page: l.page, line: l.line, text: l.text.slice(0, 240) };
}

function property(lines: Line[]): PropertyId {
  const p = emptyProperty();
  for (const l of lines) {
    const sp = l.f.match(SHEET_PLAN);
    if (sp && !p.sheet) {
      p.sheet = sp[1];
      p.plan = sp[2];
    }
  }
  for (const [k, rx] of Object.entries(LABEL) as [keyof typeof LABEL, RegExp][]) {
    if (p[k]) continue;
    for (const l of lines) {
      if ((k === 'sheet' || k === 'plan') && SHEET_PLAN.test(l.f)) continue;
      const v = grab(l, rx);
      if (v) {
        p[k] = v;
        break;
      }
    }
  }
  const all = lines.map((l) => l.f).join('\n');
  for (const [rx, name] of DISTRICTS) {
    if (rx.test(all)) {
      p.district = name;
      break;
    }
  }
  const desc = lines.find((l) => /(?:περιγραφη|ειδος ακιν|description|property type)/i.test(l.f));
  if (desc) p.description = desc.text.replace(/^[^:]*:\s*/, '').slice(0, 160);
  return p;
}

/** Reads a search certificate from page text. `baseConfidence` reflects the source (text layer vs OCR). */
export function parseCertificate(pages: PageText[], evidenceId: string, baseConfidence = 0.95): CertDraft {
  const lines = flatten(pages);
  const folded = lines.map((l) => l.f).join('\n');

  let kind: CertKind = 'unknown';
  if (/βαρων|βαρη|encumbrances|prohibitions|απαγορευσεων/i.test(folded)) kind = 'with_encumbrances';
  else if (/απλο\s*πιστοποιητικ|simple certificate/i.test(folded)) kind = 'simple';

  const issuedLine = lines.find((l) => ISSUED_RX.test(l.f));
  const issuedOn = issuedLine ? findDate(issuedLine.f.match(ISSUED_RX)![1]) : (lines.map((l) => findDate(l.f)).find(Boolean) ?? null);

  // Owners: lines inside an owners block, or any non-label line carrying a share fraction.
  const owners: Owner[] = [];
  let inOwners = false;
  for (const l of lines) {
    const isKind = KIND_RX.some(([rx]) => rx.test(l.f)) || /(?:^|\s)βαρη|encumbrances/i.test(l.f);
    if (isKind) {
      inOwners = false;
      continue;
    }
    if (/ιδιοκτητ|registered owners?|(?:^|\s)owners?\b|δικαιουχ/i.test(l.f)) {
      inOwners = true;
      if (cleanName(l.text).length < 4) continue; // a header line
    }
    if (NOT_OWNER.test(l.f) || findDate(l.f)) continue;
    const share = l.f.match(SHARE_RX);
    if (!(inOwners || share) || !/\p{L}{3,}/u.test(l.f)) continue;
    const name = cleanName(l.text);
    if (name.length < 4 || name.split(' ').length > 8) continue;
    const id = grab(l, ID_RX);
    owners.push({ name, idNumber: id ? id.replace(/\s/g, '') : null, share: share ? `${Number(share[1])}/${Number(share[2])}` : '1/1', source: ref(evidenceId, l) });
  }
  const seen = new Set<string>();
  const uniqOwners = owners.filter((o) => {
    const k = normName(o.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Encumbrances: one per line that names a kind and carries a holder, date or amount (headers are skipped).
  const encumbrances: Encumbrance[] = [];
  for (const l of lines) {
    const hit = KIND_RX.find(([rx]) => rx.test(l.f));
    if (!hit || NONE_RX.test(l.f)) continue;
    const holderRaw = grab(l, HOLDER_RX);
    const date = findDate(l.f);
    const amount = parseAmount(l.text);
    if (!holderRaw && !date && !amount) continue; // section header such as "ΒΑΡΗ ΚΑΙ ΑΠΑΓΟΡΕΥΣΕΙΣ"
    const reference = grab(l, REF_RX);
    let holder = holderRaw ?? l.text;
    holder = holder
      .replace(/(?:€|EUR|eur|ευρώ)\s*[\d.,]+|[\d.,]+\s*(?:€|EUR|ευρώ)/g, ' ')
      .replace(/\d{1,2}[./-]\d{1,2}[./-]\d{4}/g, ' ')
      .replace(reference ?? '\u0000', ' ');
    holder = fold(holder).match(LABEL_WORDS) ? removeLabelWords(holder) : holder;
    holder = holder.replace(/[|•·;:]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[-–,.\s]+$/, '').slice(0, 120);
    encumbrances.push({
      id: randomId('e_'),
      kind: hit[1],
      holder: holder || '—',
      amount,
      registeredOn: date,
      reference,
      status: RELEASED_RX.test(l.f) ? 'released' : 'active',
      source: ref(evidenceId, l),
      needsHuman: !date || !holderRaw,
    });
  }

  let separateTitle: boolean | null = null;
  if (/αδιαιρετ|undivided share|μεριδιο σε τεμαχιο|share of (?:the )?plot|χωρις ξεχωριστο τιτλο|no separate title/i.test(folded)) separateTitle = false;
  else if (/οριζοντια ιδιοκτησ|horizontal property|ξεχωριστος τιτλος|separate title/i.test(folded)) separateTitle = true;

  const prop = property(lines);

  let confidence = baseConfidence;
  if (kind === 'unknown') confidence -= 0.1;
  if (!issuedOn) confidence -= 0.1;
  if (!uniqOwners.length) confidence -= 0.15;
  if (!prop.titleNumber && !prop.registrationNo) confidence -= 0.1;
  if (encumbrances.some((e) => !e.registeredOn)) confidence -= 0.05;
  if (lines.length < 5) confidence -= 0.3;

  return {
    kind,
    issuedOn,
    property: prop,
    owners: uniqOwners,
    encumbrances,
    separateTitle,
    handwrittenRegions: 0,
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
  };
}

function removeLabelWords(s: string): string {
  let out = s;
  for (let i = 0; i < 6; i++) {
    const m = fold(out).match(new RegExp(LABEL_WORDS.source, 'i'));
    if (!m || m.index === undefined) break;
    out = `${out.slice(0, m.index)} ${out.slice(m.index + m[0].length)}`;
  }
  return out;
}

const IBAN_RX = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?)\b/g;

/** Reads the parts of a sale contract the rules need. */
export function parseContract(pages: PageText[]): Partial<Contract> {
  const lines = flatten(pages);
  const folded = lines.map((l) => l.f).join('\n');
  const text = lines.map((l) => l.text).join('\n');
  const c: Partial<Contract> = {};

  const signedM = folded.match(/(?:ημερομηνια υπογραφης|υπογραφηκε (?:σημερα|την)|made (?:on|this)|dated|signed (?:on|this)|σημερα την)\s*[:.]?\s*([^\n]{0,40})/i);
  c.signedOn = signedM ? findDate(signedM[1]) : null;
  const regM = folded.match(/(?:εγγραφη του πωλητη|seller(?:'s)? registration|registered as owner)[^\n]{0,40}?(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i);
  c.sellerRegisteredOn = regM ? findDate(regM[1]) : null;

  const priceLine = lines.find((l) => /τιμημα|purchase price|consideration|sale price|τιμη πωλησης/i.test(l.f) && parseAmount(l.text));
  c.price = priceLine ? parseAmount(priceLine.text) : null;

  const ibans = [...text.matchAll(IBAN_RX)].map((m) => m[1].replace(/\s/g, '')).filter((i) => /^[A-Z]{2}\d{2}/.test(i) && i.length >= 15);
  const formAIdx = lines.findIndex((l) => /εντυπο\s*(?:α|a)(?:$|[\s.,:)])|form\s*a(?:$|[\s.,:)])/i.test(l.f));
  const ibanNear = (from: number) => {
    for (let i = Math.max(0, from); i < Math.min(lines.length, from + 12); i++) {
      const m = lines[i].text.match(IBAN_RX);
      if (m) return m[0].replace(/\s/g, '');
    }
    return null;
  };
  const payIdx = lines.findIndex((l) => /(?:καταβαλ|πληρω|payable|paid (?:in)?to|pay(?:ment)?s? (?:shall|will)|(?:^|\s)account|λογαριασμ)/i.test(l.f) && (formAIdx < 0 || lines.indexOf(l) < formAIdx));
  c.paymentAccount = payIdx >= 0 ? ibanNear(payIdx) : (ibans[0] ?? null);

  const formAPresent = formAIdx >= 0;
  const lenders: string[] = [];
  if (formAPresent) {
    for (let i = formAIdx; i < Math.min(lines.length, formAIdx + 15); i++) {
      const v = grab(lines[i], /(?:δανειστης|lender|(?:^|\s)bank)\s*[:.]?\s*(.+)/i);
      if (v && v.length > 2) lenders.push(v.replace(IBAN_RX, '').trim().slice(0, 80));
    }
  }
  c.formA = {
    present: formAPresent,
    lenders,
    account: formAPresent ? ibanNear(formAIdx) : null,
    amount: formAPresent ? parseAmount(lines.slice(formAIdx, formAIdx + 15).map((l) => l.text).join(' ')) : null,
  };
  c.formC = /εντυπο\s*(?:γ|c)(?:$|[\s.,:)])|form\s*c(?:$|[\s.,:)])/i.test(folded);

  const sellers: Owner[] = [];
  for (const l of lines) {
    const v = grab(l, /(?:πωλητης|πωλητρια|πωλητες|vendors?|sellers?)\s*[:.]?\s*(.+)/i);
    if (!v || !/\p{L}{3,}/u.test(v)) continue;
    for (const part of v.replace(/\(.*?\)/g, ' ').split(/,|\s+και\s+|\s+and\s+/)) {
      const id = fold(part).match(ID_RX);
      const share = fold(part).match(SHARE_RX);
      const name = cleanName(part);
      if (name.length >= 4 && !sellers.some((s) => normName(s.name) === normName(name))) {
        sellers.push({ name, idNumber: id ? id[1].replace(/\s/g, '') : null, share: share ? `${share[1]}/${share[2]}` : '1/1' });
      }
    }
  }
  c.sellers = sellers;
  c.property = property(lines);
  return c;
}

/** Field-by-field comparison of two independent readings. */
export function compareReadings(a: CertDraft, b: CertDraft): string[] {
  const diffs: string[] = [];
  if (a.kind !== 'unknown' && b.kind !== 'unknown' && a.kind !== b.kind) diffs.push('certificate type');
  if (a.issuedOn && b.issuedOn && a.issuedOn !== b.issuedOn) diffs.push('issue date');
  for (const k of ['sheet', 'plan', 'parcel', 'registrationNo', 'titleNumber'] as (keyof PropertyId)[]) {
    const x = a.property[k];
    const y = b.property[k];
    if (x && y && x.replace(/\s/g, '') !== y.replace(/\s/g, '')) diffs.push(k);
  }
  if (a.owners.length !== b.owners.length) diffs.push('number of owners');
  const kinds: EncumbranceKind[] = ['mortgage', 'memo', 'prohibition', 'deposited_contract'];
  for (const k of kinds) {
    const x = a.encumbrances.filter((e) => e.kind === k && e.status !== 'released').length;
    const y = b.encumbrances.filter((e) => e.kind === k && e.status !== 'released').length;
    if (x !== y) diffs.push(`${k.replace('_', ' ')} count`);
  }
  return diffs;
}

/** Merges two readings: agreed values stand, the primary reading fills gaps, disagreements are listed. */
export function mergeReadings(primary: CertDraft, secondary: CertDraft | null): CertDraft & { disagreements: string[] } {
  if (!secondary) return { ...primary, disagreements: [] };
  const disagreements = compareReadings(primary, secondary);
  const property = { ...primary.property };
  for (const k of Object.keys(property) as (keyof PropertyId)[]) property[k] = property[k] ?? secondary.property[k];
  // Keep the reading that found more entries: missing an encumbrance is the failure that matters.
  const encumbrances = primary.encumbrances.length >= secondary.encumbrances.length ? primary.encumbrances : secondary.encumbrances;
  return {
    kind: primary.kind !== 'unknown' ? primary.kind : secondary.kind,
    issuedOn: primary.issuedOn ?? secondary.issuedOn,
    property,
    owners: primary.owners.length ? primary.owners : secondary.owners,
    encumbrances: disagreements.length ? encumbrances.map((e) => ({ ...e, needsHuman: true })) : encumbrances,
    separateTitle: primary.separateTitle ?? secondary.separateTitle,
    handwrittenRegions: Math.max(primary.handwrittenRegions, secondary.handwrittenRegions),
    confidence: Number(Math.min(1, (primary.confidence + secondary.confidence) / 2 + (disagreements.length ? -0.15 : 0.05)).toFixed(2)),
    disagreements,
  };
}

export { emptyContract };
