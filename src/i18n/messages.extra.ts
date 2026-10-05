// Report, portal and glossary translations for the languages beyond the core six
// (Turkish, French, Chinese, Portuguese, Spanish, Italian). Keys mirror messages.ts.
import type { Lang } from '../domain/types';
import { tr } from './extra/tr';
import { fr } from './extra/fr';
import { zh } from './extra/zh';
import { pt } from './extra/pt';
import { es } from './extra/es';
import { it } from './extra/it';

export interface ExtraCatalog {
  msg: Record<string, string>;
  ui: Record<string, string>;
  glossary: [string, string][]; // [term, definition] in GLOSSARY order
}

export const EXTRA: Partial<Record<Lang, ExtraCatalog>> = { tr, fr, zh, pt, es, it };
