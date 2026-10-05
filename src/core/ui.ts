// Shared UI components built on the safe DOM builder.
import { h, icon, type Child } from './dom';
import { t } from './i18n';

export function toast(message: string, kind: 'ok' | 'warn' | 'error' | 'info' = 'info', ms = 4200): void {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const el = h('div', { class: `toast toast-${kind}` }, icon(kind === 'ok' ? 'check' : kind === 'error' ? 'alert' : kind === 'warn' ? 'alert' : 'info', 18), h('span', null, message));
  host.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export function modal(title: string, body: Child, actions: Child = null, opts: { wide?: boolean; onClose?: () => void } = {}): { close: () => void; root: HTMLElement } {
  const dlg = h('dialog', { class: `modal ${opts.wide ? 'modal-wide' : ''}`, 'aria-label': title }) as HTMLDialogElement;
  const close = () => {
    dlg.close();
    dlg.remove();
    opts.onClose?.();
  };
  dlg.append(h('header', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': t('Close'), onclick: close }, icon('x'))), h('div', { class: 'modal-body' }, body));
  if (actions) dlg.append(h('footer', { class: 'modal-foot' }, actions));
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });
  document.body.append(dlg);
  dlg.showModal();
  return { close, root: dlg };
}

export function confirmDialog(title: string, message: string, confirmLabel = t('Confirm'), danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(
      title,
      h('p', null, message),
      [
        h('button', { class: 'btn', onclick: () => finish(false) }, t('Cancel')),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => finish(true) }, confirmLabel),
      ],
      { onClose: () => !done && resolve(false) },
    );
    function finish(v: boolean) {
      done = true;
      m.close();
      resolve(v);
    }
  });
}

export function badge(text: string, tone: 'red' | 'amber' | 'green' | 'info' | 'neutral' | 'teal' = 'neutral'): HTMLElement {
  return h('span', { class: `badge badge-${tone}` }, text);
}

export function card(title: Child, body: Child, opts: { icon?: string; actions?: Child; cls?: string; help?: string } = {}): HTMLElement {
  return h(
    'section',
    { class: `card ${opts.cls ?? ''}` },
    title
      ? h(
          'header',
          { class: 'card-head' },
          h('h3', null, opts.icon ? icon(opts.icon, 18) : null, title),
          opts.help ? helpTip(opts.help) : null,
          opts.actions ? h('div', { class: 'card-actions' }, opts.actions) : null,
        )
      : null,
    h('div', { class: 'card-body' }, body),
  );
}

export function helpTip(text: string): HTMLElement {
  const btn = h('button', { class: 'help', type: 'button', 'aria-label': t('Help'), title: text }, icon('info', 16));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    modal(t('How this works'), h('p', null, text));
  });
  return btn;
}

export function empty(iconName: string, title: string, text: string, action?: Child): HTMLElement {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon(iconName, 32)), h('h3', null, title), h('p', null, text), action ?? null);
}

export function spinner(label = t('Working…')): HTMLElement {
  return h('div', { class: 'spinner-wrap', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', null, label));
}

export function progressBar(): { el: HTMLElement; set: (f: number, label?: string) => void } {
  const bar = h('div', { class: 'progress-fill' });
  const label = h('div', { class: 'progress-label' });
  const el = h('div', { class: 'progress' }, h('div', { class: 'progress-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar), label);
  return {
    el,
    set: (f, l) => {
      const pct = Math.round(Math.max(0, Math.min(1, f)) * 100);
      bar.style.width = `${pct}%`;
      bar.parentElement!.setAttribute('aria-valuenow', String(pct));
      if (l !== undefined) label.textContent = l;
    },
  };
}

export interface FieldOpts {
  label: string;
  value?: string | number | null;
  type?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  name?: string;
  autocomplete?: string;
  options?: [string, string][];
  rows?: number;
  onInput?: (v: string) => void;
  dir?: string;
  inputmode?: string;
}

export function field(o: FieldOpts): HTMLElement {
  const id = `f_${Math.random().toString(36).slice(2, 9)}`;
  let control: HTMLElement;
  const common = { id, name: o.name ?? id, required: o.required, placeholder: o.placeholder, autocomplete: o.autocomplete ?? 'off', dir: o.dir, inputmode: o.inputmode };
  if (o.options) {
    control = h('select', common, o.options.map(([v, l]) => h('option', { value: v, selected: String(o.value ?? '') === v }, l)));
  } else if (o.rows) {
    control = h('textarea', { ...common, rows: o.rows }, String(o.value ?? ''));
  } else {
    control = h('input', { ...common, type: o.type ?? 'text', value: o.value ?? '' });
  }
  if (o.onInput) control.addEventListener(o.options ? 'change' : 'input', (e) => o.onInput!((e.target as HTMLInputElement).value));
  return h('div', { class: 'field' }, h('label', { for: id }, o.label, o.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null), control, o.hint ? h('small', { class: 'hint' }, o.hint) : null);
}

export function toggle(label: string, checked: boolean, onChange: (v: boolean) => void, hint?: string): HTMLElement {
  const input = h('input', { type: 'checkbox', role: 'switch', checked }) as HTMLInputElement;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle' }, input, h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }), h('span', { class: 'toggle-text' }, label, hint ? h('small', { class: 'hint' }, hint) : null));
}

export function tabs(items: { id: string; label: string; count?: number; tone?: string }[], active: string, onSelect: (id: string) => void): HTMLElement {
  return h(
    'nav',
    { class: 'tabs', role: 'tablist' },
    items.map((it) =>
      h(
        'button',
        { class: `tab ${it.id === active ? 'active' : ''}`, role: 'tab', 'aria-selected': it.id === active ? 'true' : 'false', onclick: () => onSelect(it.id) },
        it.label,
        it.count ? h('span', { class: `tab-count ${it.tone ?? ''}` }, String(it.count)) : null,
      ),
    ),
  );
}

export function kv(rows: [string, Child][]): HTMLElement {
  return h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v ?? '—')]));
}

export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text).then(
    () => toast(t('Copied'), 'ok', 1800),
    () => toast(t('Could not copy — select and copy manually'), 'warn'),
  );
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename }) as HTMLAnchorElement;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } }) as HTMLInputElement;
    input.addEventListener('change', () => {
      resolve([...(input.files ?? [])]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function dropZone(label: string, accept: string, onFiles: (f: File[]) => void): HTMLElement {
  const zone = h(
    'div',
    { class: 'drop', tabindex: 0, role: 'button', 'aria-label': label },
    icon('upload', 28),
    h('strong', null, label),
    h('small', null, t('Drop files here, or tap to choose. PDF or photos (JPG, PNG).')),
  );
  const open = async () => {
    const f = await pickFiles(accept);
    if (f.length) onFiles(f);
  };
  zone.addEventListener('click', open);
  zone.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open()));
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) onFiles(files);
  });
  return zone;
}

export function severityTone(s: string): 'red' | 'amber' | 'green' | 'info' {
  return s === 'red' ? 'red' : s === 'amber' ? 'amber' : s === 'green' ? 'green' : 'info';
}
