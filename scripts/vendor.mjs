// Copies self-hosted runtime assets (OCR engine, PDF worker) into public/vendor,
// so the app never depends on a third-party CDN at runtime.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'public', 'vendor');
const copies = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
];
for (const [from, to] of copies) {
  const dest = join(out, to);
  mkdirSync(join(dest, '..'), { recursive: true });
  copyFileSync(join(root, from), dest);
}
for (const lang of ['ell', 'eng']) {
  if (!existsSync(join(out, 'tessdata', `${lang}.traineddata.gz`))) {
    console.warn(`missing public/vendor/tessdata/${lang}.traineddata.gz — run: npm run tessdata`);
  }
}
console.log('vendor assets ready');
