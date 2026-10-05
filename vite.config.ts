import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Files fetched lazily (offline OCR pack) are cached on demand, not at install.
const LAZY = [/^vendor\/tesseract\//, /^vendor\/tessdata\//];
const SKIP = [/\.map$/, /^sw\.js$/, /^_headers$/, /^_redirects$/, /^CNAME$/, /^\.nojekyll$/];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Writes dist/sw.js with a content-hashed precache list, so every deploy is a new, atomic app version. */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'katharos-service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files = walk(outDir)
        .map((f) => relative(outDir, f).split('\\').join('/'))
        .filter((f) => !SKIP.some((r) => r.test(f)) && !LAZY.some((r) => r.test(f)))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const template = readFileSync('src/sw/sw.js', 'utf8');
      const precache = ['./', ...files.filter((f) => f !== 'index.html'), 'index.html'];
      writeFileSync(
        join(outDir, 'sw.js'),
        template
          .replace('__VERSION__', version)
          .replace('[/*__PRECACHE__*/]', JSON.stringify(precache)),
      );
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ version, built: new Date().toISOString() }));
      console.log(`service worker: version ${version}, ${precache.length} files precached`);
    },
  };
}

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 900,
  },
  plugins: [serviceWorker()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as never);
