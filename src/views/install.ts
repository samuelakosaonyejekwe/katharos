// "Install app" — one-tap install where the browser allows it, step-by-step help everywhere else.
import { h, icon } from '../core/dom';
import { t } from '../core/i18n';
import { canPromptInstall, isStandalone, platform, promptInstall } from '../core/pwa';
import { modal, toast } from '../core/ui';

function steps(list: string[]): HTMLElement {
  return h('ol', { class: 'install-steps' }, list.map((s) => h('li', null, h('span', null, s))));
}

export function installInstructions(): HTMLElement {
  const p = platform();
  const blocks: Record<string, [string, string[]]> = {
    ios: [t('iPhone and iPad'), [t('Open this page in Safari (on iOS 16.4+ Chrome, Edge and Firefox work too).'), t('Tap the Share button (square with an arrow).'), t('Choose “Add to Home Screen”, then “Add”.'), t('Open Katharos from your home screen — it runs full-screen and works offline.')]],
    android: [t('Android phones and tablets'), [t('Tap “Install app” below, or open the browser menu (⋮).'), t('Choose “Install app” or “Add to Home screen”.'), t('Confirm. Katharos appears with your apps and works offline.')]],
    'mac-safari': [t('Mac (Safari)'), [t('In the menu bar choose File → “Add to Dock”.'), t('Katharos opens in its own window and works offline.')]],
    'desktop-chromium': [t('Windows, Mac, Linux, ChromeOS (Chrome or Edge)'), [t('Click “Install app” below, or the install icon at the right of the address bar.'), t('Katharos opens in its own window, can be pinned to the taskbar or dock, and works offline.')]],
    firefox: [t('Firefox'), [t('On Android: menu (⋮) → “Install”.'), t('On desktop: open this page in Chrome, Edge or Safari to install it, or keep it as a pinned tab — it still works offline after the first visit.')]],
    other: [t('Your browser'), [t('Open the browser menu and look for “Install app” or “Add to Home screen”.'), t('If there is none, bookmark this page — it still works offline after the first visit.')]],
  };
  const [title, list] = blocks[p] ?? blocks.other;
  const others = Object.entries(blocks).filter(([k]) => k !== p && k !== 'other');
  return h(
    'div',
    { class: 'stack' },
    isStandalone() ? h('div', { class: 'callout ok' }, icon('check'), t('Katharos is installed and running as an app on this device.')) : null,
    h('div', { class: 'callout' }, icon('wifiOff'), h('div', null, h('strong', null, t('Works in airplane mode.')), ' ', t('After the first visit everything — matters, documents, checks, reports, deadlines and the Greek OCR pack once cached — runs from this device with no connection.'))),
    h('h3', null, title),
    steps(list),
    h(
      'details',
      { class: 'faq' },
      h('summary', null, t('Instructions for other devices')),
      others.map(([, [tt, l]]) => h('div', { style: { marginBottom: '14px' } }, h('strong', null, tt), steps(l))),
    ),
  );
}

export function showInstallHelp(): void {
  const actions = canPromptInstall()
    ? h(
        'button',
        {
          class: 'btn btn-primary',
          onclick: async () => {
            const r = await promptInstall();
            if (r === 'accepted') {
              toast(t('Installed — find Katharos with your apps'), 'ok');
              m.close();
            }
          },
        },
        icon('install', 18),
        t('Install app'),
      )
    : null;
  const m = modal(t('Install Katharos on this device'), installInstructions(), actions);
}
