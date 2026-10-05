// Document reading: PDF text layer (pdf.js), offline Greek OCR (Tesseract, self-hosted),
// and Azure AI Document Intelligence / Google Document AI through the gateway.
// Amazon Textract is deliberately absent: it does not support Greek.
import { settings } from '../core/settings';
import type { PageText } from '../domain/types';
import { blobToBase64, fetchWithTimeout, gateway, gatewayConfigured } from './http';

const base = () => new URL('./', document.baseURI).href;

type PdfJs = typeof import('pdfjs-dist');
let pdfjsP: Promise<PdfJs> | null = null;

async function pdfjs(): Promise<PdfJs> {
  if (!pdfjsP) {
    pdfjsP = import('pdfjs-dist').then((m) => {
      m.GlobalWorkerOptions.workerSrc = `${base()}vendor/pdf.worker.min.mjs`;
      return m;
    });
  }
  return pdfjsP;
}

export async function openPdf(file: Blob) {
  const lib = await pdfjs();
  return lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
}

/** Text layer of a digital PDF (as downloaded from the Land Registry portal), grouped into lines. */
export async function pdfText(file: Blob): Promise<{ pages: PageText[]; chars: number; pageCount: number }> {
  const doc = await openPdf(file);
  const pages: PageText[] = [];
  let chars = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      const row = rows.get(y) ?? [];
      row.push({ x: item.transform[4], s: item.str });
      rows.set(y, row);
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, r]) => r.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    chars += lines.join('').length;
    pages.push({ page: n, lines });
  }
  const pageCount = doc.numPages;
  await doc.destroy();
  return { pages, chars, pageCount };
}

/** Renders PDF pages to PNG images (for OCR and for the side-by-side source viewer). */
export async function pdfPageImages(file: Blob, maxPages = 30, scale = 2): Promise<Blob[]> {
  const doc = await openPdf(file);
  const out: Blob[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, canvas } as never).promise;
    out.push(await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png')));
  }
  await doc.destroy();
  return out;
}

export async function renderPdfPage(file: Blob, pageNo: number, canvas: HTMLCanvasElement, width: number): Promise<number> {
  const doc = await openPdf(file);
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
  const unscaled = page.getViewport({ scale: 1 });
  const ratio = window.devicePixelRatio || 1;
  const vp = page.getViewport({ scale: (width / unscaled.width) * ratio });
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  canvas.style.width = `${Math.ceil(vp.width / ratio)}px`;
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, canvas } as never).promise;
  const total = doc.numPages;
  await doc.destroy();
  return total;
}

// ------------------------------------------------------------------ offline OCR (Greek + English)

export async function localOcr(images: Blob[], onProgress?: (p: number, label: string) => void): Promise<{ pages: PageText[]; confidence: number }> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['ell', 'eng'], 1, {
    workerPath: `${base()}vendor/tesseract/worker.min.js`,
    corePath: `${base()}vendor/tesseract/`,
    langPath: `${base()}vendor/tessdata`,
    gzip: true,
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => onProgress?.(m.progress, m.status),
  });
  const pages: PageText[] = [];
  let confSum = 0;
  try {
    for (let i = 0; i < images.length; i++) {
      onProgress?.(i / images.length, `page ${i + 1} of ${images.length}`);
      const { data } = await worker.recognize(images[i]);
      pages.push({ page: i + 1, lines: data.text.split('\n').map((l: string) => l.trim()).filter(Boolean) });
      confSum += data.confidence;
    }
  } finally {
    await worker.terminate();
  }
  return { pages, confidence: images.length ? confSum / images.length / 100 : 0 };
}

export async function ocrPackCached(): Promise<boolean> {
  try {
    const c = await caches.open('katharos-ocr');
    return Boolean(await c.match('vendor/tessdata/ell.traineddata.gz')) || Boolean(await caches.match(`${base()}vendor/tessdata/ell.traineddata.gz`));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ Azure Document Intelligence / Google Document AI

export interface CloudReading {
  pages: PageText[];
  handwritten: number;
  provider: string;
}

/** Azure (primary) then Google (backup) via the gateway; or Azure called directly from this browser. */
export async function cloudOcr(file: Blob): Promise<CloudReading> {
  const s = settings();
  if (s.ocrMode === 'gateway' && gatewayConfigured()) {
    const body = { mime: file.type || 'application/pdf', data: await blobToBase64(file) };
    try {
      return await gateway<CloudReading>('/v1/ocr/azure', body, { timeoutMs: 180_000 });
    } catch (e) {
      console.warn('Azure OCR failed, trying Google Document AI', e);
      return gateway<CloudReading>('/v1/ocr/google', body, { timeoutMs: 180_000 });
    }
  }
  if (s.ocrMode === 'azure-direct' && s.azureEndpoint && s.azureKey) return azureDirect(file);
  throw new Error('Cloud OCR is not configured');
}

async function azureDirect(file: Blob): Promise<CloudReading> {
  const s = settings();
  const endpoint = s.azureEndpoint.replace(/\/+$/, '');
  const res = await fetchWithTimeout(`${endpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': s.azureKey, 'content-type': 'application/json' },
    body: JSON.stringify({ base64Source: await blobToBase64(file) }),
    timeoutMs: 60_000,
  });
  if (res.status !== 202) throw new Error(`Azure analyze: HTTP ${res.status} ${await res.text()}`);
  const op = res.headers.get('operation-location');
  if (!op) throw new Error('Azure did not return an operation location (check CORS exposes Operation-Location)');
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetchWithTimeout(op, { headers: { 'Ocp-Apim-Subscription-Key': s.azureKey }, timeoutMs: 30_000 });
    const j = await poll.json();
    if (j.status === 'succeeded') return parseAzure(j);
    if (j.status === 'failed') throw new Error(`Azure analyze failed: ${JSON.stringify(j.error ?? {})}`);
  }
  throw new Error('Azure analyze timed out');
}

export function parseAzure(j: any): CloudReading {
  const r = j.analyzeResult ?? {};
  const pages: PageText[] = (r.pages ?? []).map((p: any) => ({ page: p.pageNumber, lines: (p.lines ?? []).map((l: any) => l.content) }));
  const handwritten = (r.styles ?? []).filter((st: any) => st.isHandwritten && (st.confidence ?? 1) > 0.5).length;
  return { pages, handwritten, provider: 'azure' };
}
