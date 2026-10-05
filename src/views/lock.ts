// First run (create the encrypted vault) and unlock.
import { h, icon, mount } from '../core/dom';
import { passphraseScore } from '../core/crypto';
import { t, setUiLang, uiLang } from '../core/i18n';
import { vault, wipeEverything } from '../core/db';
import { confirmDialog, spinner, toggle } from '../core/ui';
import { showInstallHelp } from './install';
import { passkeyEnrolled, verifyPasskey } from '../core/passkey';
import { ALL_LANGS, type Lang } from '../domain/types';
import { LANG_NAMES } from '../i18n/langs';

export function lockScreen(root: HTMLElement, onUnlocked: (firstRun: boolean, seedDemo: boolean) => void): void {
  void vault.exists().then((exists) => (exists ? renderUnlock(root, onUnlocked) : renderCreate(root, onUnlocked)));
}

function langSwitch(): HTMLElement {
  const sel = h('select', { 'aria-label': t('Language'), class: 'lang-select' }, ALL_LANGS.map((l) => h('option', { value: l, selected: l === uiLang() }, LANG_NAMES[l]))) as HTMLSelectElement;
  sel.addEventListener('change', async () => {
    await setUiLang(sel.value as Lang);
    location.reload();
  });
  return h('label', { class: 'lang-pick' }, icon('globe', 18), sel);
}

function head(subtitle: string): HTMLElement {
  return h(
    'div',
    { class: 'row-between' },
    h('div', { class: 'row' }, h('img', { class: 'logo', src: './icons/icon.svg', alt: '' }), h('div', null, h('h1', { style: { margin: 0 } }, 'Katharos'), h('small', { class: 'muted' }, subtitle))),
    langSwitch(),
  );
}

function renderCreate(root: HTMLElement, done: (firstRun: boolean, seedDemo: boolean) => void): void {
  const pass = h('input', { type: 'password', autocomplete: 'new-password', placeholder: t('At least 12 characters, or 4+ words'), 'aria-label': t('Passphrase') }) as HTMLInputElement;
  const pass2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: t('Repeat passphrase'), 'aria-label': t('Repeat passphrase') }) as HTMLInputElement;
  const meter = h('div', { class: 'strength' }, h('span'), h('span'), h('span'), h('span'));
  const msg = h('small', { class: 'hint' });
  let seed = true;
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('shield', 18), t('Create my secure vault')) as HTMLButtonElement;

  pass.addEventListener('input', () => {
    const s = passphraseScore(pass.value);
    meter.className = `strength s${s}`;
    msg.textContent = [t('Too short'), t('Weak'), t('Fair'), t('Strong'), t('Very strong')][s];
  });

  const form = h(
    'form',
    { class: 'stack' },
    h('div', { class: 'field' }, h('label', null, t('Choose a vault passphrase')), pass, meter, msg),
    h('div', { class: 'field' }, h('label', null, t('Confirm passphrase')), pass2),
    toggle(t('Add a sample matter to explore'), seed, (v) => (seed = v), t('Fictitious data, clearly marked. Delete it any time.')),
    btn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (passphraseScore(pass.value) < 2) return void (msg.textContent = t('Please choose a longer passphrase (12+ characters or 4+ words).'));
    if (pass.value !== pass2.value) return void (msg.textContent = t('The two passphrases do not match.'));
    btn.disabled = true;
    mount(btn, spinner(t('Creating encrypted vault…')));
    await vault.create(pass.value);
    done(true, seed);
  });

  mount(
    root,
    h(
      'div',
      { class: 'lock' },
      h(
        'div',
        { class: 'lock-card' },
        head(t('Title Desk · clean-title due diligence for Cyprus')),
        h(
          'ul',
          { class: 'features' },
          [
            ['shield', t('Reads Land Registry search certificates and contracts in Greek, and runs the advocate-written checks.')],
            ['globe', t('Issues reports in Greek, English and the buyer’s own language — 12 languages in all.')],
            ['calendar', t('Watches the five-working-day window, the six-month deposit deadline and every staged payment.')],
            ['wifiOff', t('Installs on any phone or computer and works fully offline.')],
            ['lock', t('Everything is encrypted on this device with your passphrase. Nothing is sent anywhere unless you connect an integration.')],
          ].map(([i, s]) => h('li', null, icon(i, 18), h('span', null, s))),
        ),
        form,
        h('div', { class: 'callout warn' }, icon('key'), h('span', null, t('Your passphrase cannot be recovered. Keep it in a password manager and export encrypted backups from Settings.'))),
        h('div', { class: 'row-between' }, h('a', { class: 'btn btn-ghost btn-sm', href: '#/' }, icon('arrowLeft', 16), t('Public site')), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => showInstallHelp() }, icon('install', 16), t('Install this app'))),
      ),
    ),
  );
  pass.focus();
}

function renderUnlock(root: HTMLElement, done: (firstRun: boolean, seedDemo: boolean) => void): void {
  const pass = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': t('Passphrase'), placeholder: t('Vault passphrase') }) as HTMLInputElement;
  const msg = h('small', { class: 'hint', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('unlock', 18), t('Unlock')) as HTMLButtonElement;
  let attempts = 0;
  const form = h('form', { class: 'stack' }, h('div', { class: 'field' }, h('label', null, t('Passphrase')), pass, msg), btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    mount(btn, spinner(t('Unlocking…')));
    const ok = await vault.unlock(pass.value);
    if (ok && (await passkeyEnrolled())) {
      // Second factor: the passkey enrolled on this device.
      mount(btn, spinner(t('Confirm with your passkey…')));
      let passed = false;
      try {
        passed = await verifyPasskey();
      } catch {
        passed = false;
      }
      if (passed) return done(false, false);
      vault.lock();
      btn.disabled = false;
      mount(btn, icon('unlock', 18), t('Unlock'));
      msg.textContent = t('The passkey check did not succeed. Try again.');
      return;
    }
    if (ok) return done(false, false);
    attempts++;
    // Slow down repeated guesses on this device.
    await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** attempts)));
    btn.disabled = false;
    mount(btn, icon('unlock', 18), t('Unlock'));
    msg.textContent = t('That passphrase did not unlock the vault.');
    pass.select();
  });
  mount(
    root,
    h(
      'div',
      { class: 'lock' },
      h(
        'div',
        { class: 'lock-card' },
        head(t('Your vault is locked')),
        form,
        h('a', { class: 'btn btn-ghost btn-sm', href: '#/' }, icon('arrowLeft', 16), t('Public site')),
        h(
          'details',
          { class: 'faq' },
          h('summary', null, t('Forgot the passphrase?')),
          h('p', null, t('The data is encrypted with your passphrase and cannot be opened without it. You can restore an exported backup after resetting this device.')),
          h(
            'button',
            {
              class: 'btn btn-danger btn-sm',
              onclick: async () => {
                if (await confirmDialog(t('Reset this device?'), t('This permanently deletes every matter and document stored in Katharos on this device.'), t('Delete everything'), true)) {
                  await wipeEverything();
                  location.reload();
                }
              },
            },
            icon('trash', 16),
            t('Reset this device'),
          ),
        ),
      ),
    ),
  );
  pass.focus();
}
