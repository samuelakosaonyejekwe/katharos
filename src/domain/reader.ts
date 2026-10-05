// The reading pipeline: two independent readings of every document, compared
// field by field. Anything uncertain, handwritten or contradictory is flagged for a person.
import { randomId } from '../core/crypto';
import { getFile } from '../core/db';
import { aiAvailable, aiReadCertificate, aiReadContract } from '../integrations/ai';
import { cloudOcr, localOcr, pdfPageImages, pdfText } from '../integrations/ocr';
import { settings } from '../core/settings';
import { gatewayConfigured } from '../integrations/http';
import { appendEvent } from './audit';
import { mergeReadings, parseCertificate, parseContract, type CertDraft } from './extract';
import { actor, saveMatter } from './matters';
import type { CertOrigin, Certificate, Contract, Evidence, Matter, PageText } from './types';

export type Progress = (step: string, fraction?: number) => void;

interface Reading {
  pages: PageText[];
  by: string;
  confidence: number;
  handwritten: number;
}

function cloudOcrReady(): boolean {
  const s = settings();
  return (s.ocrMode === 'gateway' && gatewayConfigured()) || (s.ocrMode === 'azure-direct' && Boolean(s.azureEndpoint && s.azureKey));
}

async function imagesOf(file: File): Promise<Blob[]> {
  return file.type === 'application/pdf' ? pdfPageImages(file) : [file];
}

/** First reading: the PDF text layer when there is one, otherwise OCR (cloud if configured, else on-device). */
async function primaryReading(file: File, progress: Progress): Promise<Reading> {
  if (file.type.startsWith('text/') || /\.txt$/i.test(file.name)) {
    const pages = (await file.text()).split('\f').map((p, i) => ({ page: i + 1, lines: p.split(/\r?\n/) }));
    return { pages, by: 'text', confidence: 0.95, handwritten: 0 };
  }
  if (file.type === 'application/pdf') {
    progress('Reading the PDF text layer', 0.1);
    const t = await pdfText(file);
    if (t.chars >= 150) return { pages: t.pages, by: 'pdf-text', confidence: 0.95, handwritten: 0 };
  }
  if (cloudOcrReady()) {
    progress('Cloud OCR (Greek)', 0.2);
    const r = await cloudOcr(file);
    return { pages: r.pages, by: r.provider, confidence: 0.92, handwritten: r.handwritten };
  }
  progress('On-device Greek OCR', 0.2);
  const r = await localOcr(await imagesOf(file), (p, label) => progress(`On-device OCR: ${label}`, 0.2 + p * 0.4));
  // On-device OCR cannot detect handwriting, so it never claims high confidence.
  return { pages: r.pages, by: 'ocr-local', confidence: Math.min(0.85, r.confidence), handwritten: 0 };
}

export async function readCertificate(m: Matter, ev: Evidence, origin: CertOrigin, progress: Progress = () => {}): Promise<Certificate> {
  const file = await getFile(ev.id);
  if (!file) throw new Error('Document not found in the vault');

  const a = await primaryReading(file, progress);
  const draftA = parseCertificate(a.pages, ev.id, a.confidence);
  draftA.handwrittenRegions = a.handwritten;
  const readBy = [a.by];

  let draftB: CertDraft | null = null;
  try {
    if (aiAvailable()) {
      progress('Second reading: AI model reads the page images', 0.65);
      draftB = await aiReadCertificate(file, ev.id);
      readBy.push('ai');
    } else if (a.by === 'pdf-text') {
      progress('Second reading: on-device OCR of the page images', 0.65);
      const r = await localOcr(await imagesOf(file), (p, label) => progress(`Second reading: ${label}`, 0.65 + p * 0.3));
      draftB = parseCertificate(r.pages, ev.id, Math.min(0.85, r.confidence));
      readBy.push('ocr-local');
    } else if (a.by === 'ocr-local' && cloudOcrReady()) {
      const r = await cloudOcr(file);
      draftB = parseCertificate(r.pages, ev.id, 0.92);
      draftB.handwrittenRegions = r.handwritten;
      readBy.push(r.provider);
    }
  } catch (e) {
    // A failed second reading never blocks work; it lowers confidence and is logged.
    await appendEvent(m, 'system', 'reading.second_failed', { evidenceId: ev.id, error: String((e as Error).message ?? e) });
  }

  progress('Comparing readings and running the checks', 0.97);
  const merged = mergeReadings(draftA, draftB);
  if (!draftB) merged.confidence = Math.min(merged.confidence, 0.89); // single reading → human review

  const cert: Certificate = {
    id: randomId('c_'),
    evidenceId: ev.id,
    kind: merged.kind,
    issuedOn: merged.issuedOn,
    origin,
    property: merged.property,
    owners: merged.owners,
    encumbrances: merged.encumbrances,
    separateTitle: merged.separateTitle,
    handwrittenRegions: merged.handwrittenRegions,
    confidence: merged.confidence,
    disagreements: merged.disagreements,
    readBy,
    addedAt: new Date().toISOString(),
  };
  ev.text = a.pages;
  ev.pages = a.pages.length;
  m.certificates.push(cert);
  if (['instructed', 'searching'].includes(m.status)) m.status = 'extracted';
  await appendEvent(m, actor(), 'certificate.read', {
    certificateId: cert.id,
    evidenceId: ev.id,
    readBy,
    confidence: cert.confidence,
    disagreements: cert.disagreements,
    encumbrances: cert.encumbrances.length,
    origin,
  });
  await saveMatter(m);
  progress('Done', 1);
  return cert;
}

/** Reads a contract and fills only empty fields — typed facts are never overwritten. */
export async function readContract(m: Matter, ev: Evidence, progress: Progress = () => {}): Promise<{ filled: string[]; proposed: Partial<Contract> }> {
  const file = await getFile(ev.id);
  if (!file) throw new Error('Document not found in the vault');
  const a = await primaryReading(file, progress);
  const local = parseContract(a.pages);
  let ai: Partial<Contract> = {};
  if (aiAvailable()) {
    progress('Second reading: AI model', 0.6);
    try {
      ai = await aiReadContract(file);
    } catch (e) {
      await appendEvent(m, 'system', 'reading.second_failed', { evidenceId: ev.id, error: String((e as Error).message ?? e) });
    }
  }
  const proposed: Partial<Contract> = { ...local };
  for (const [k, v] of Object.entries(ai)) {
    const cur = (proposed as Record<string, unknown>)[k];
    if (cur === null || cur === undefined || (Array.isArray(cur) && !cur.length)) (proposed as Record<string, unknown>)[k] = v;
  }
  const filled: string[] = [];
  const c = m.contract as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(proposed)) {
    if (v === null || v === undefined) continue;
    const cur = c[k];
    const empty = cur === null || cur === undefined || (Array.isArray(cur) && !cur.length) || (k === 'formA' && !(cur as Contract['formA']).present && (v as Contract['formA']).present) || (k === 'property' && !Object.values(cur as object).some(Boolean));
    if (empty) {
      c[k] = v;
      filled.push(k);
    } else if (k === 'formC' && v === true && !cur) {
      c[k] = true;
      filled.push(k);
    }
  }
  ev.text = a.pages;
  ev.pages = a.pages.length;
  await appendEvent(m, actor(), 'contract.read', { evidenceId: ev.id, readBy: [a.by, ...(Object.keys(ai).length ? ['ai'] : [])], filled });
  await saveMatter(m);
  progress('Done', 1);
  return { filled, proposed };
}
