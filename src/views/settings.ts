import { h, icon, mount } from '../core/dom';
import { exportVault, openExport, restoreVault } from '../core/backup';
import { activeLicence, ROLE_LABEL } from '../core/licence';
import { enrolPasskey, passkeyEnrolled, passkeysSupported, removePasskey, verifyPasskey } from '../core/passkey';
import { passphraseScore } from '../core/crypto';
import { storageEstimate, vault, wipeEverything } from '../core/db';
import { t } from '../core/i18n';
import { checkForUpdate, enableNotifications, isStandalone, pwa } from '../core/pwa';
import { navigate } from '../core/router';
import { saveSettings, settings } from '../core/settings';
import { badge, card, confirmDialog, downloadBlob, field, kv, modal, pickFiles, toast, toggle } from '../core/ui';
import { appendEvent } from '../domain/audit';
import { actor, saveMatter } from '../domain/matters';
import { putFile } from '../core/db';
import type { Matter } from '../domain/types';
import { pageHead } from './common';
import { showInstallHelp } from './install';

export function applyTheme(theme: string): void {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('katharos.theme', theme);
  } catch {
    /* ignore */
  }
}

export function savedTheme(): string {
  try {
    return localStorage.getItem('katharos.theme') ?? 'auto';
  } catch {
    return 'auto';
  }
}

function askPassword(title: string, confirm: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const p1 = h('input', { type: 'password', autocomplete: 'new-password' }) as HTMLInputElement;
    const p2 = h('input', { type: 'password', autocomplete: 'new-password' }) as HTMLInputElement;
    let done = false;
    const md = modal(
      title,
      h('div', { class: 'stack-sm' }, h('div', { class: 'field' }, h('label', null, t('Password')), p1), confirm ? h('div', { class: 'field' }, h('label', null, t('Repeat password')), p2) : null),
      [
        h('button', { class: 'btn', onclick: () => md.close() }, t('Cancel')),
        h(
          'button',
          {
            class: 'btn btn-primary',
            onclick: () => {
              if (confirm && (p1.value !== p2.value || passphraseScore(p1.value) < 2)) return toast(t('Use a strong password and type it twice'), 'warn');
              done = true;
              md.close();
              resolve(p1.value);
            },
          },
          t('OK'),
        ),
      ],
      { onClose: () => !done && resolve(null) },
    );
    p1.focus();
  });
}

export async function importMatterFile(): Promise<void> {
  const [f] = await pickFiles('.json,application/json', false);
  if (!f) return;
  const pass = await askPassword(t('Password for this matter file'), false);
  if (pass === null) return;
  try {
    const data = await openExport<{ matter: Matter; files: Record<string, string> }>(f, pass, 'katharos-matter');
    for (const [id, dataUrl] of Object.entries(data.files)) {
      const blob = await (await fetch(dataUrl)).blob();
      const ev = data.matter.evidence.find((e) => e.id === id);
      await putFile(id, blob, ev?.filename ?? id);
    }
    await appendEvent(data.matter, actor(), 'matter.imported', { from: f.name });
    await saveMatter(data.matter, true);
    toast(t('Matter {ref} imported', { ref: data.matter.matterRef }), 'ok');
    navigate(`/matters/${data.matter.id}`);
  } catch {
    toast(t('Could not open the file — check the password'), 'error');
  }
}

export async function settingsView(): Promise<HTMLElement> {
  const s = settings();
  const draft = { ...s };
  const est = await storageEstimate();

  const profile = card(
    t('Firm and advocate'),
    h(
      'div',
      { class: 'stack-sm' },
      h(
        'div',
        { class: 'form-grid' },
        field({ label: t('Firm name'), value: draft.firmName, onInput: (v) => (draft.firmName = v) }),
        field({ label: t('Issuing advocate'), value: draft.advocateName, onInput: (v) => (draft.advocateName = v), hint: t('Appears on every issued report') }),
        field({ label: t('Advocate email'), type: 'email', value: draft.advocateEmail, onInput: (v) => (draft.advocateEmail = v), hint: t('Buyers send questions here') }),
        field({ label: t('Advocate mobile (international)'), type: 'tel', value: draft.advocatePhone, onInput: (v) => (draft.advocatePhone = v), hint: t('For buyers’ WhatsApp questions') }),
        field({ label: t('Matter reference prefix'), value: draft.matterPrefix, placeholder: 'e.g. KT', onInput: (v) => (draft.matterPrefix = v.trim()) }),
        field({ label: t('Legal panel (rule owners)'), value: draft.legalPanel, onInput: (v) => (draft.legalPanel = v) }),
      ),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', onclick: async () => (await saveSettings(draft), toast(t('Saved'), 'ok')) }, icon('check', 16), t('Save'))),
    ),
    { icon: 'users' },
  );

  const themeSel = field({
    label: t('Appearance'),
    value: savedTheme(),
    options: [
      ['auto', t('Match the device')],
      ['light', t('Light')],
      ['dark', t('Dark')],
    ],
    onInput: applyTheme,
  });

  const passkeyRow = h('div');
  const drawPasskey = async () => {
    if (!passkeysSupported()) return mount(passkeyRow, h('small', { class: 'muted' }, t('Passkeys are not available in this browser.')));
    const on = await passkeyEnrolled();
    mount(
      passkeyRow,
      toggle(
        t('Require a passkey to unlock (two-factor)'),
        on,
        async (v) => {
          try {
            if (v) {
              await enrolPasskey();
              toast(t('Passkey added — it will be asked for after your passphrase'), 'ok');
            } else {
              if (!(await verifyPasskey())) throw new Error(t('The passkey check did not succeed. Try again.'));
              await removePasskey();
              toast(t('Passkey removed'), 'ok');
            }
          } catch (e) {
            toast((e as Error).message, 'error');
          }
          await drawPasskey();
        },
        t('Fingerprint, face, device PIN or a security key, on top of your passphrase.'),
      ),
    );
  };
  void drawPasskey();

  const security = card(
    t('Security'),
    h(
      'div',
      { class: 'stack-sm' },
      field({
        label: t('Lock automatically after'),
        value: String(s.autoLockMinutes),
        options: [
          ['5', t('5 minutes')],
          ['15', t('15 minutes')],
          ['30', t('30 minutes')],
          ['60', t('1 hour')],
          ['0', t('Never (not recommended)')],
        ],
        onInput: (v) => void saveSettings({ autoLockMinutes: Number(v) }),
      }),
      themeSel,
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              const p = await askPassword(t('New vault passphrase'), true);
              if (!p) return;
              try {
                await vault.rekey(p);
                toast(t('Passphrase changed — everything re-encrypted'), 'ok');
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            },
          },
          icon('key', 16),
          t('Change passphrase'),
        ),
        h('button', { class: 'btn', onclick: () => vault.lock() }, icon('lock', 16), t('Lock now')),
      ),
      passkeyRow,
      kv([
        [t('Encryption'), 'AES-256-GCM · PBKDF2-SHA-256 600,000'],
        [t('Where data lives'), t('This device only (IndexedDB), encrypted')],
      ]),
    ),
    { icon: 'shield' },
  );

  const backup = card(
    t('Backup and restore'),
    h(
      'div',
      { class: 'stack-sm' },
      h('p', { class: 'muted' }, t('A backup is the whole vault, still encrypted with your passphrase. Restore it on any device to carry on — this is also how you survive a lost or broken device.')),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn btn-primary', onclick: async () => downloadBlob(await exportVault(), `katharos-backup-${new Date().toISOString().slice(0, 10)}.json`) }, icon('download', 16), t('Export encrypted backup')),
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              const [f] = await pickFiles('.json,application/json', false);
              if (!f) return;
              if (!(await confirmDialog(t('Restore this backup?'), t('It replaces everything currently in Katharos on this device. You will then unlock with the passphrase the backup was made with.'), t('Restore'), true))) return;
              try {
                const r = await restoreVault(f);
                toast(t('Restored {m} matters and {f} documents', { m: r.matters, f: r.files }), 'ok');
                vault.lock();
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            },
          },
          icon('upload', 16),
          t('Restore backup'),
        ),
        h('button', { class: 'btn', onclick: () => importMatterFile() }, icon('upload', 16), t('Import a matter file')),
      ),
    ),
    { icon: 'download' },
  );

  const mirrorsHost = h('div', { class: 'list' });
  void fetch('./mirrors.json', { cache: 'no-store' })
    .then((r) => r.json())
    .then((j: { mirrors: { name: string; url: string }[] }) => {
      const all = [{ name: t('This copy'), url: location.origin + location.pathname }, ...j.mirrors.filter((m) => !(location.origin + location.pathname).startsWith(m.url))];
      mount(mirrorsHost, all.map((m) => h('a', { class: 'list-item', href: m.url, target: '_blank', rel: 'noopener' }, icon('globe', 18), h('div', { class: 'grow' }, h('div', { class: 'title' }, m.name), h('small', { class: 'muted' }, m.url)))));
    })
    .catch(() => mount(mirrorsHost, h('small', { class: 'muted' }, t('Mirror list unavailable offline — the installed app keeps working.'))));

  const device = card(
    t('App and device'),
    h(
      'div',
      { class: 'stack-sm' },
      kv([
        [t('Installed'), isStandalone() ? badge(t('Yes'), 'green') : h('button', { class: 'btn btn-sm btn-accent', onclick: () => showInstallHelp() }, icon('install', 14), t('Install'))],
        [t('Version'), h('code', null, pwa.version || 'dev')],
        [t('Storage used'), est ? `${(est.usage / 1048576).toFixed(1)} MB / ${(est.quota / 1048576).toFixed(0)} MB` : '—'],
      ]),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn btn-sm', onclick: async () => (await checkForUpdate(), toast(pwa.updateReady ? t('Update ready') : t('You have the latest version'), 'ok')) }, icon('refresh', 14), t('Check for updates')),
        h('button', { class: 'btn btn-sm', onclick: async () => toast(t('Notifications: {p}', { p: await enableNotifications() }), 'info') }, icon('bell', 14), t('Enable reminders')),
      ),
      h('h4', null, t('Other copies of this app')),
      h('small', { class: 'muted' }, t('The same app is published on several independent hosts. If one is unreachable, open another — your data is on your device, so restore a backup there.')),
      mirrorsHost,
    ),
    { icon: 'phone' },
  );

  const danger = card(
    t('Reset'),
    h(
      'div',
      { class: 'stack-sm' },
      h('p', { class: 'muted' }, t('Deletes every matter, document and setting stored by Katharos on this device. Export a backup first.')),
      h(
        'button',
        {
          class: 'btn btn-danger',
          onclick: async () => {
            if (await confirmDialog(t('Delete everything on this device?'), t('This cannot be undone.'), t('Delete everything'), true)) {
              await wipeEverything();
              location.replace(location.pathname);
            }
          },
        },
        icon('trash', 16),
        t('Reset this device'),
      ),
    ),
    { icon: 'alert' },
  );

  const lic = await activeLicence();
  const licence = card(
    t('Licence'),
    h('div', { class: 'stack-sm' }, kv([[t('Licensed to'), lic?.holder || '—'], [t('Plan'), lic ? lic.roles.map((r) => t(ROLE_LABEL[r])).join(', ') : '—'], [t('Valid until'), lic?.exp ?? t('No expiry date.')], [t('Licence ID'), h('code', null, lic?.id || '—')]]), h('a', { class: 'btn btn-sm', href: '#/firm' }, icon('key', 14), t('Manage licence'))),
    { icon: 'key' },
  );
  return h('div', { class: 'stack' }, pageHead(t('Settings')), h('div', { class: 'columns' }, h('div', { class: 'stack' }, profile, backup, licence), h('div', { class: 'stack' }, security, device)), danger);
}
