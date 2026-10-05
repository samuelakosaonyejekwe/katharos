// Collects every English interface string so each language catalogue can be checked for gaps.
// 1) every literal passed to t('…'); 2) human-readable literals in data tables rendered via t(variable).
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const files = walk('src').filter((f) => f.endsWith('.ts') && !f.includes('/i18n/'));
const out = new Set();
const lit = /'((?:[^'\\\n]|\\.)*)'/g;
const DATA_FILES = ['src/views/guide.ts', 'src/views/costs.ts', 'src/views/live.ts', 'src/views/common.ts', 'src/views/matter.ts', 'src/app.ts', 'src/views/more.ts', 'src/integrations/registry.ts', 'src/integrations/feeds.ts', 'src/domain/rules.ts', 'src/domain/reader.ts', 'src/views/integrations.ts', 'src/views/public.ts'];
const unescape = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\\n]|\\.)*)'/g)) out.add(unescape(m[1]));
  if (DATA_FILES.includes(f)) {
    for (const m of src.matchAll(lit)) {
      const s = unescape(m[1]);
      if (s.length < 3 || !/[A-Za-z]{2}/.test(s)) continue;
      if (/^[a-z0-9_.\-/#:]+$/.test(s)) continue; // ids, paths, keys
      if (/^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/.test(s) && /(btn|card|stack|row|list|grid|icon|muted|badge|callout|tab|stat|seg|field|form|hide|title|grow|num|code|mono|term|el|item|body|meta|text|source|decision|bar|node|chip|day|out|dow|cal|spark|area|line|box|edge|live|eu|dot|state|wiring|report|sev|small|fp|portal|hero|lang|select|pick|page|canvas|viewer|pagetext|hl|ln)/.test(s)) continue; // class names
      if (/^(https?:|M\d|application\/|image\/|text\/|anthropic|eu\.|claude-|\.\/|vendor|katharos[-.]|[A-Z_]{3,}$)/.test(s)) continue;
      if (/[{}()=;]/.test(s) && !/\{\w+\}/.test(s)) continue;
      if (/^[,.:;\s]/.test(s) || /", |: '|^(severity_|st_|dl_|kind\.|field\.|reason\.)/.test(s) || /^[a-z]+[A-Z]\w*$/.test(s)) continue;
      out.add(s);
    }
  }
}
const list = [...out].sort();
writeFileSync('src/i18n/strings.en.json', JSON.stringify(list, null, 1));
console.log(`${list.length} strings`);
