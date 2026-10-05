// Integrations hub: every wire in the system, its live state, its configuration and a test button.
import { h, icon, mount, s } from '../core/dom';
import { t } from '../core/i18n';
import { onSwMessage, postToSw } from '../core/pwa';
import { saveSettings, settings, type AiMode, type OcrMode } from '../core/settings';
import { badge, card, field, modal, spinner, toast, toggle } from '../core/ui';
import { gatewayHealth, INTEGRATIONS, type Integration } from '../integrations/registry';
import { ocrPackCached } from '../integrations/ocr';
import { pageHead } from './common';

function diagram(states: Record<string, string>): SVGElement {
  const live = (id: string) => (states[id] === 'ready' ? 'edge live' : 'edge');
  const box = (x: number, y: number, w: number, label: string, sub: string, id?: string) =>
    s(
      'g',
      null,
      s('rect', { class: 'box', x, y, width: w, height: 46, rx: 10, 'stroke-width': 1.4, stroke: id && states[id] === 'ready' ? 'var(--green)' : id && states[id] === 'error' ? 'var(--red)' : 'var(--border)' }),
      s('text', { x: x + w / 2, y: y + 20, 'text-anchor': 'middle', 'font-size': 12.5, 'font-weight': 650 }, label),
      s('text', { x: x + w / 2, y: y + 36, 'text-anchor': 'middle', 'font-size': 10.5, fill: 'var(--muted)' }, sub),
    );
  return s(
    'svg',
    { class: 'diagram', viewBox: '0 0 860 360', role: 'img', 'aria-label': t('Architecture: browsers connect to public data directly and to the firm’s EU gateway, which connects to AI, OCR, messaging and screening services.') },
    s('rect', { class: 'eu', x: 300, y: 10, width: 550, height: 340, rx: 16 }),
    s('text', { x: 316, y: 32, 'font-size': 12, fill: 'var(--info)', 'font-weight': 700 }, t('European Union — where client documents are processed')),
    box(20, 40, 240, t('Lawyer’s browser'), t('Katharos Desk · encrypted vault'), 'pdf'),
    box(20, 150, 240, t('Buyer’s phone'), t('Portal · link-encrypted, offline'), undefined),
    box(20, 260, 240, t('Public data sources'), t('ECB · Eurostat · news · holidays'), 'feed-fx'),
    box(330, 150, 200, t('Firm gateway'), t('EU · keys never in browser'), 'gateway'),
    box(600, 50, 230, t('Claude on Bedrock (EU)'), t('second reading · explain'), 'ai'),
    box(600, 115, 230, t('Azure Document Intelligence'), t('Greek OCR · backup: Google'), 'azure'),
    box(600, 180, 230, t('WhatsApp · Amazon SES'), t('neutral status only'), 'whatsapp'),
    box(600, 245, 230, t('OpenSanctions'), t('party screening'), 'opensanctions'),
    box(330, 290, 200, t('JCC e-signature'), t('signed PDF uploaded'), 'jcc'),
    s('path', { class: live('gateway'), d: 'M260 63 C300 63 300 173 330 173' }),
    s('path', { class: live('ai'), d: 'M530 165 C565 165 565 73 600 73' }),
    s('path', { class: live('azure'), d: 'M530 170 C565 170 565 138 600 138' }),
    s('path', { class: live('whatsapp'), d: 'M530 178 L600 203' }),
    s('path', { class: live('opensanctions'), d: 'M530 185 C565 185 565 268 600 268' }),
    s('path', { class: 'edge live', d: 'M140 86 L140 150' }),
    s('path', { class: 'edge live', d: 'M140 260 L140 196' }),
    s('path', { class: 'edge live', d: 'M100 260 C60 200 60 140 100 86' }),
    s('path', { class: 'edge', d: 'M260 75 C290 75 300 300 330 313' }),
  );
}

export async function integrationsView(): Promise<HTMLElement> {
  const st = settings();
  const statesHost = h('div', { class: 'grid' });
  const diagramHost = h('div');
  const states: Record<string, string> = {};

  const drawStates = async () => {
    mount(statesHost, spinner(t('Checking every integration…')));
    const results = await Promise.all(INTEGRATIONS.map(async (i) => ({ i, s: await i.state().catch((e) => ({ state: 'error' as const, detail: (e as Error).message })) })));
    for (const r of results) states[r.i.id] = r.s.state;
    mount(diagramHost, diagram(states));
    const layers = [...new Set(INTEGRATIONS.map((i) => i.layer))];
    mount(
      statesHost,
      layers.flatMap((layer) => results.filter((r) => r.i.layer === layer).map((r) => integrationCard(r.i, r.s.state, r.s.detail))),
    );
  };

  const integrationCard = (i: Integration, state: string, detail: string) => {
    const out = h('small', { class: 'muted' });
    return h(
      'div',
      { class: 'integration' },
      h('div', { class: 'row-between' }, h('strong', null, t(i.name)), h('span', { class: `state ${state}` }, h('span', { class: 'dot' }), { ready: t('Ready'), partial: t('Available'), off: t('Off'), error: t('Problem') }[state] ?? state)),
      h('small', null, t(i.purpose)),
      h('div', { class: 'wiring' }, icon('plug', 14), ' ', t(i.wiring)),
      h('div', { class: 'row-between' }, badge(t(i.layer), 'neutral'), badge(t(i.dataLocation), i.dataLocation.startsWith('EU') || i.dataLocation.includes('device') ? 'teal' : 'neutral')),
      h('small', { class: 'muted' }, t(detail)),
      i.test
        ? h(
            'div',
            { class: 'row' },
            h(
              'button',
              {
                class: 'btn btn-sm',
                onclick: async (e: Event) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.disabled = true;
                  out.textContent = t('Testing…');
                  try {
                    out.textContent = await i.test!();
                    toast(`${t(i.name)}: ${t('OK')}`, 'ok');
                  } catch (err) {
                    out.textContent = (err as Error).message;
                    toast(`${t(i.name)}: ${(err as Error).message}`, 'error', 7000);
                  }
                  b.disabled = false;
                },
              },
              icon('refresh', 14),
              t('Test now'),
            ),
            out,
          )
        : null,
    );
  };

  // ---- configuration
  const gw = { url: st.gatewayUrl, token: st.gatewayToken, backup: st.gatewayBackupUrl };
  const gatewayCfg = card(
    t('Gateway'),
    h(
      'div',
      { class: 'stack-sm' },
      h('p', { class: 'muted' }, t('The gateway is a small service your firm deploys in an EU region (AWS Lambda in Milan by default). It keeps API keys off every device, keeps documents in the EU, and lets each browser use AI, cloud OCR, WhatsApp, email and screening. Deploy two in different regions or providers for redundancy.')),
      h('div', { class: 'form-grid' }, field({ label: t('Gateway URL'), value: gw.url, placeholder: 'https://….lambda-url.eu-south-1.on.aws', onInput: (v) => (gw.url = v.trim()) }), field({ label: t('Backup gateway URL'), value: gw.backup, placeholder: t('optional — another region or provider'), onInput: (v) => (gw.backup = v.trim()) }), field({ label: t('Access token'), type: 'password', value: gw.token, onInput: (v) => (gw.token = v.trim()) })),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn btn-primary',
            onclick: async () => {
              if (gw.url && !/^https:\/\//.test(gw.url)) return toast(t('The gateway URL must start with https://'), 'warn');
              await saveSettings({ gatewayUrl: gw.url, gatewayToken: gw.token, gatewayBackupUrl: gw.backup });
              const { h: health, err } = await gatewayHealth(true);
              toast(health ? t('Gateway connected') : t('Saved, but the gateway did not answer: {e}', { e: err ?? '' }), health ? 'ok' : 'warn', 6000);
              await drawStates();
            },
          },
          icon('check', 16),
          t('Save and test'),
        ),
        h('button', { class: 'btn', onclick: () => deployHelp() }, icon('book', 16), t('How to deploy the gateway')),
      ),
    ),
    { icon: 'plug' },
  );

  const aiCfg = card(
    t('AI model'),
    h(
      'div',
      { class: 'stack-sm' },
      field({
        label: t('Mode'),
        value: st.aiMode,
        options: [
          ['off', t('Off — rules and on-device reading only')],
          ['gateway', t('Via the EU gateway (Amazon Bedrock, EU region) — recommended')],
          ['direct', t('Direct from this browser (Anthropic API — processed outside the EU)')],
        ],
        onInput: async (v) => {
          if (v === 'direct') modal(t('Processing outside the EU'), h('p', null, t('In direct mode, documents are sent from this browser to the Anthropic API, which processes data in the US or globally. The report requires EU processing for client documents — use the gateway for real matters, and direct mode only for testing with fictitious documents.')));
          await saveSettings({ aiMode: v as AiMode });
          await drawStates();
        },
      }),
      h('div', { class: 'form-grid' }, field({ label: t('Primary model'), value: st.aiModel, hint: t('On Bedrock the gateway adds the region prefix'), onInput: (v) => void saveSettings({ aiModel: v.trim() }) }), field({ label: t('Backup model'), value: st.aiBackupModel, onInput: (v) => void saveSettings({ aiBackupModel: v.trim() }) }), field({ label: t('Anthropic API key (direct mode only)'), type: 'password', value: st.anthropicKey, onInput: (v) => void saveSettings({ anthropicKey: v.trim() }) })),
      h('small', { class: 'muted' }, t('The AI is a second reader and an explainer. It never decides a legal check; every finding is approved by the advocate.')),
    ),
    { icon: 'sparkle' },
  );

  const ocrState = h('small', { class: 'muted' });
  void ocrPackCached().then((c) => (ocrState.textContent = c ? t('Offline Greek OCR pack is cached on this device.') : t('Offline Greek OCR pack not cached yet.')));
  const ocrCfg = card(
    t('Document reading (OCR)'),
    h(
      'div',
      { class: 'stack-sm' },
      field({
        label: t('Scanned documents are read by'),
        value: st.ocrMode,
        options: [
          ['local', t('This device (Tesseract, Greek + English) — works offline')],
          ['gateway', t('Azure Document Intelligence via the gateway, Google Document AI as backup')],
          ['azure-direct', t('Azure Document Intelligence direct from this browser')],
        ],
        onInput: async (v) => {
          await saveSettings({ ocrMode: v as OcrMode });
          await drawStates();
        },
      }),
      h('div', { class: 'form-grid' }, field({ label: t('Azure endpoint (direct mode)'), value: st.azureEndpoint, placeholder: 'https://<name>.cognitiveservices.azure.com', onInput: (v) => void saveSettings({ azureEndpoint: v.trim() }) }), field({ label: t('Azure key (direct mode)'), type: 'password', value: st.azureKey, onInput: (v) => void saveSettings({ azureKey: v.trim() }) })),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn btn-sm',
            onclick: (e: Event) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.disabled = true;
              const off = onSwMessage((d) => {
                if (d?.type === 'OCR_PACK_PROGRESS') {
                  ocrState.textContent = t('Caching offline OCR pack… {d}/{n}', { d: d.done, n: d.total });
                  if (d.done === d.total) {
                    off();
                    b.disabled = false;
                    toast(t('Offline Greek OCR is ready — works in airplane mode'), 'ok');
                  }
                }
              });
              postToSw({ type: 'CACHE_OCR_PACK' });
              if (!navigator.serviceWorker?.controller) {
                ocrState.textContent = t('Install or reload the app once to enable offline caching.');
                b.disabled = false;
              }
            },
          },
          icon('download', 14),
          t('Cache offline OCR pack (≈16 MB)'),
        ),
        ocrState,
      ),
    ),
    { icon: 'scan' },
  );

  const msgCfg = card(
    t('Messaging and screening'),
    h(
      'div',
      { class: 'stack-sm' },
      toggle(t('Send WhatsApp template messages through the gateway'), st.whatsappEnabled, (v) => void saveSettings({ whatsappEnabled: v }).then(drawStates), t('Needs a WhatsApp Business account and an approved neutral template on the gateway. Device links (wa.me) always work without it.')),
      toggle(t('Send emails through the gateway (Amazon SES)'), st.emailViaGateway, (v) => void saveSettings({ emailViaGateway: v }).then(drawStates), t('Otherwise the device’s email app opens with the message ready.')),
      field({ label: t('OpenSanctions API key (optional)'), type: 'password', value: st.openSanctionsKey, onInput: (v) => void saveSettings({ openSanctionsKey: v.trim() }) }),
    ),
    { icon: 'message' },
  );

  void drawStates();
  return h(
    'div',
    { class: 'stack' },
    pageHead(t('Integrations'), t('Every connection in Katharos — what it does, where the data goes, whether it is working right now. Configure and test them here; the core product works fully without any of them.'), h('button', { class: 'btn', onclick: () => void drawStates() }, icon('refresh', 18), t('Re-check all'))),
    card(t('How everything is wired'), diagramHost, { icon: 'layers', help: t('Animated lines are live connections. Client documents only ever go to services inside the EU boundary; WhatsApp carries a neutral status line only; GitHub holds code, never client data.') }),
    statesHost,
    h('h2', null, t('Configure')),
    h('div', { class: 'grid-2' }, gatewayCfg, aiCfg, ocrCfg, msgCfg),
  );
}

function deployHelp(): void {
  modal(
    t('Deploy the gateway'),
    h(
      'div',
      { class: 'stack-sm' },
      h('p', null, t('The gateway package is supplied to licensed firms together with their licence. It runs in an EU cloud region (AWS Lambda in Milan by default) or on any Node 20+ host in the EU — never on a personal computer — and stays up when any single machine is off.')),
      h(
        'ol',
        { class: 'install-steps' },
        [
          t('Deploy the gateway package to your EU cloud account with the script supplied with it.'),
          t('Copy the gateway URL and access token it prints into the fields above, then press “Save and test”.'),
          t('For redundancy, deploy a second copy in another EU region and enter it as the backup gateway URL.'),
        ].map((x) => h('li', null, h('span', null, x))),
      ),
      h('p', { class: 'muted' }, t('Secrets for AI, OCR, WhatsApp, email and screening are set as encrypted settings on the gateway itself — never on this device.')),
    ),
    null,
    { wide: true },
  );
}
