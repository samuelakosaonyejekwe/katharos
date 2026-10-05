// Interface language. Strings are written in English in the code (gettext style) and looked up in
// the selected language's catalogue, which is loaded on demand (one small chunk per language, cached
// for offline use). A missing translation falls back to English, never to a blank.
import { ALL_LANGS, RTL, type Lang } from '../domain/types';

export type UiLang = Lang;

const loaders = import.meta.glob<{ default: Record<string, string> }>('../i18n/ui/*.json');

let current: UiLang = 'en';
let catalog: Record<string, string> = {};
const listeners = new Set<() => void>();

const LOCALES: Record<Lang, string> = {
  en: 'en-GB',
  el: 'el-GR',
  tr: 'tr-TR',
  he: 'he-IL',
  fr: 'fr-FR',
  zh: 'zh-CN',
  ar: 'ar',
  pt: 'pt-PT',
  es: 'es-ES',
  it: 'it-IT',
  ru: 'ru-RU',
  uk: 'uk-UA',
};

export function uiLang(): UiLang {
  return current;
}

async function load(l: Lang): Promise<Record<string, string>> {
  if (l === 'en') return {};
  const loader = loaders[`../i18n/ui/${l}.json`];
  if (!loader) return {};
  try {
    return (await loader()).default;
  } catch {
    return {};
  }
}

function applyDocument(): void {
  document.documentElement.lang = current;
  document.documentElement.dir = RTL.includes(current) ? 'rtl' : 'ltr';
}

export async function setUiLang(l: UiLang): Promise<void> {
  catalog = await load(l);
  current = l;
  applyDocument();
  try {
    localStorage.setItem('katharos.ui', l);
  } catch {
    /* ignore */
  }
  listeners.forEach((f) => f());
}

/** Picks the saved language, else the device language, else English. */
export async function initUiLang(): Promise<void> {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('katharos.ui');
  } catch {
    /* ignore */
  }
  const device = (navigator.languages ?? [navigator.language]).map((x) => x?.slice(0, 2).toLowerCase()).find((x) => (ALL_LANGS as string[]).includes(x));
  const pick = (saved && (ALL_LANGS as string[]).includes(saved) ? saved : device ?? 'en') as Lang;
  catalog = await load(pick);
  current = pick;
  applyDocument();
}

export function onUiLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Translate an English UI string; `{name}` placeholders are filled from params. */
export function t(text: string, params?: Record<string, string | number>): string {
  const base = catalog[text] || text;
  return params ? fill(base, params) : base;
}

export function fill(s: string, params: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));
}

export function locale(): string {
  return LOCALES[current];
}

export function money(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR', maximumFractionDigits: digits }).format(n);
}

export function num(n: number, digits = 0): string {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(n);
}
