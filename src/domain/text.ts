import { msg } from '../i18n/messages';
import type { Finding, Lang } from './types';

const LOCALE: Record<Lang, string> = { en: 'en-GB', el: 'el-GR', tr: 'tr-TR', he: 'he-IL', fr: 'fr-FR', zh: 'zh-CN', ar: 'ar', pt: 'pt-PT', es: 'es-ES', it: 'it-IT', ru: 'ru-RU', uk: 'uk-UA' };

/** Formats ISO dates inside a parameter in the reader's language (2026-09-29 → 29 Sept 2026). */
export function localDates(s: string, lang: Lang): string {
  return s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => {
    try {
      return new Date(Date.UTC(+y, +m - 1, +d)).toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    } catch {
      return `${d}/${m}/${y}`;
    }
  });
}

/** Renders a finding in a buyer language, translating nested catalogue keys in its parameters. */
export function findingText(f: Finding, lang: Lang): string {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(f.params)) {
    if (typeof v !== 'string') params[k] = v;
    else if (k === 'reasons') {
      params[k] = v
        .split(';')
        .map((r) => {
          const [key, fields] = r.split('|');
          return msg(key, lang, { fields: fields ?? '' });
        })
        .join('; ');
    } else if (/^(field|kind|reason)\./.test(v)) params[k] = msg(v, lang);
    else params[k] = localDates(v, lang);
  }
  return msg(f.msg, lang, params);
}
