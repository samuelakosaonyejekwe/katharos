// Integrations hub: every wire in the system, its live state, its configuration and a test button.
import { h, icon, mount, s } from '../core/dom';
import { t } from '../core/i18n';
import { onSwMessage, postToSw } from '../core/pwa';
import { saveSettings, settings, type AiMode, type OcrMode } from '../core/settings';
import { badge, card, field, modal, pickFiles, spinner, toast, toggle } from '../core/ui';
import { builtInCases, evaluate, parseTestSet, type EvalSummary } from '../domain/evaluate';
import { gatewayHealth, INTEGRATIONS, type Integration } from '../integrations/registry';
import { ocrPackCached } from '../integrations/ocr';
import { pageHead } from './common';

function diagram(states: Record<string, string>): SVGElement {
  const services: [string, string, string][] = [
    ['ai', t('Claude on Amazon Bedrock (EU)'), t('second reading · explain')],
    ['azure', t('Azure Document Intelligence (EU)'), t('Greek OCR · handwriting check')],
    ['whatsapp', t('WhatsApp Business'), t('neutral status only')],
    ['email', t('Brevo email (EU)'), t('status + portal link')],
    ['licence', t('Licence store'), t('billing · EU VAT')],
    ['jcc', t('JCC e-signature'), t('signed PDF uploaded')],
  ];
  const stroke = (id?: string) => (id && states[id] === 'ready' ? 'var(--green)' : id && states[id] === 'error' ? 'var(--red)' : 'var(--border)');
  const box = (x: number, y: number, w: number, hgt: number, label: string, sub: string, id?: string) =>
    s(
      'g',
      null,
      s('rect', { class: 'box', x, y, width: w, height: hgt, rx: 10, 'stroke-width': 1.4, stroke: stroke(id) }),
      s('text', { x: x + 14, y: y + hgt / 2 - 3, 'font-size': 12.5, 'font-weight': 650 }, label),
      s('text', { x: x + 14, y: y + hgt / 2 + 13, 'font-size': 10.5, fill: 'var(--muted)' }, sub),
    );
  const ROW = 52;
  const top = 40;
  const sx = 470;
  const browserY = top + (services.length * ROW) / 2 - 30;
  return s(
    'svg',
    { class: 'diagram', viewBox: `0 0 860 ${top + services.length * ROW + 150}`, role: 'img', 'aria-label': t('Architecture: each browser connects directly to public data and to the organisation’s own AI, OCR and messaging accounts; no Katharos server is involved.') },
    s('rect', { class: 'eu', x: sx - 24, y: top - 30, width: 860 - sx + 14, height: services.length * ROW + 30, rx: 16 }),
    s('text', { x: sx - 8, y: top - 10, 'font-size': 12, fill: 'var(--info)', 'font-weight': 700 }, t('Your own accounts — called directly from the browser')),
    box(20, browserY, 300, 60, t('This browser'), t('Katharos Desk · encrypted vault · rules'), 'pdf'),
    services.map(([id, label, sub], i) => {
      const y = top + i * ROW + 6;
      return [
        s('path', { class: states[id] === 'ready' ? 'edge live' : 'edge', d: `M320 ${browserY + 30} C400 ${browserY + 30} 400 ${y + 20} ${sx} ${y + 20}` }),
        box(sx, y, 360, 40, label, sub, id),
      ];
    }),
    box(20, top + services.length * ROW + 20, 300, 50, t('Buyer’s phone'), t('Portal · link-encrypted, offline')),
    box(sx, top + services.length * ROW + 20, 360, 50, t('Public data sources'), t('ECB · Eurostat · news · holidays'), 'feed-fx'),
    box(20, top + services.length * ROW + 82, 810, 44, t('Static hosting (free) — the app itself'), t('GitHub Pages · optional mirrors · cached on every device')),
    s('path', { class: 'edge live', d: `M170 ${browserY + 60} L170 ${top + services.length * ROW + 20}` }),
    s('path', { class: 'edge live', d: `M320 ${browserY + 40} C400 ${browserY + 40} 400 ${top + services.length * ROW + 45} ${sx} ${top + services.length * ROW + 45}` }),
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
  const save = async (patch: Partial<typeof st>) => {
    await saveSettings(patch);
    await drawStates();
  };

  const aiCfg = card(
    t('AI model (Claude on Amazon Bedrock, EU)'),
    h(
      'div',
      { class: 'stack-sm' },
      field({
        label: t('Mode'),
        value: st.aiMode,
        options: [
          ['off', t('Off — rules and on-device reading only')],
          ['bedrock', t('My Amazon Bedrock account, EU region — recommended')],
          ['gateway', t('My own gateway (advanced)')],
          ['direct', t('Anthropic API key (processed outside the EU — testing only)')],
        ],
        onInput: async (v) => {
          if (v === 'direct') modal(t('Processing outside the EU'), h('p', null, t('In this mode documents are sent from this browser to the Anthropic API, which processes data in the US or globally. Use Bedrock in an EU region for real client documents, and this mode only for tests with fictitious documents.')));
          await save({ aiMode: v as AiMode });
        },
      }),
      h(
        'div',
        { class: 'form-grid' },
        field({ label: t('Bedrock API key'), type: 'password', value: st.bedrockApiKey, onInput: (v) => void saveSettings({ bedrockApiKey: v.trim() }) }),
        field({
          label: t('EU region'),
          value: st.bedrockRegion,
          options: [
            ['eu-central-1', 'Frankfurt (eu-central-1)'],
            ['eu-west-1', 'Ireland (eu-west-1)'],
            ['eu-west-3', 'Paris (eu-west-3)'],
            ['eu-south-1', 'Milan (eu-south-1)'],
            ['eu-north-1', 'Stockholm (eu-north-1)'],
            ['eu-south-2', 'Spain (eu-south-2)'],
            ['eu-central-2', 'Zurich (eu-central-2)'],
          ],
          onInput: (v) => void save({ bedrockRegion: v }),
        }),
        field({ label: t('Primary model'), value: st.aiModel, onInput: (v) => void saveSettings({ aiModel: v.trim() }) }),
        field({ label: t('Backup model'), value: st.aiBackupModel, onInput: (v) => void saveSettings({ aiBackupModel: v.trim() }) }),
        field({ label: t('Anthropic API key (testing only)'), type: 'password', value: st.anthropicKey, onInput: (v) => void saveSettings({ anthropicKey: v.trim() }) }),
      ),
      h('ol', { class: 'install-steps' }, [t('In your AWS console open Amazon Bedrock in an EU region and enable access to the Claude models.'), t('Create a Bedrock API key (Bedrock → API keys) and paste it here.'), t('Press “Test now” on the AI model card above. Usage is billed to your AWS account.')].map((x) => h('li', null, h('span', null, x)))),
      h('small', { class: 'muted' }, t('The AI is a second reader and an explainer. It never decides a legal check; every finding is approved by a person. Keys are stored encrypted in this device’s vault.')),
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
          ['local', t('This device (Greek + English) — free, works offline')],
          ['azure-direct', t('My Azure Document Intelligence resource (EU) — detects handwriting')],
          ['gateway', t('My own gateway (advanced)')],
        ],
        onInput: (v) => void save({ ocrMode: v as OcrMode }),
      }),
      h('div', { class: 'form-grid' }, field({ label: t('Azure endpoint'), value: st.azureEndpoint, placeholder: 'https://<name>.cognitiveservices.azure.com', onInput: (v) => void saveSettings({ azureEndpoint: v.trim() }) }), field({ label: t('Azure key'), type: 'password', value: st.azureKey, onInput: (v) => void saveSettings({ azureKey: v.trim() }) })),
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
    t('Messaging'),
    h(
      'div',
      { class: 'stack-sm' },
      h('p', { class: 'muted' }, t('Without any setup, Katharos opens WhatsApp or your email app on this device with the message ready — free. Connect your own accounts to send automatically.')),
      h(
        'div',
        { class: 'columns' },
        h('div', { class: 'stack-sm' }, h('h4', { style: { margin: 0 } }, 'WhatsApp Business (Meta Cloud API)'), field({ label: t('Access token'), type: 'password', value: st.waToken, onInput: (v) => void saveSettings({ waToken: v.trim() }) }), field({ label: t('Phone number ID'), value: st.waPhoneId, onInput: (v) => void saveSettings({ waPhoneId: v.trim() }) }), field({ label: t('Approved template name'), value: st.waTemplate, onInput: (v) => void saveSettings({ waTemplate: v.trim() }), hint: t('A neutral utility template such as “There is an update in your portal”.') })),
        h('div', { class: 'stack-sm' }, h('h4', { style: { margin: 0 } }, t('Email (Brevo)')), field({ label: t('Brevo API key'), type: 'password', value: st.brevoKey, onInput: (v) => void saveSettings({ brevoKey: v.trim() }) }), field({ label: t('Sender email (verified in Brevo)'), type: 'email', value: st.brevoSender, onInput: (v) => void saveSettings({ brevoSender: v.trim() }) }), field({ label: t('Sender name'), value: st.brevoSenderName, onInput: (v) => void saveSettings({ brevoSenderName: v }) })),
      ),
      h('button', { class: 'btn btn-sm', onclick: () => void drawStates() }, icon('check', 14), t('Save and re-check')),
    ),
    { icon: 'message' },
  );

  const gw = { url: st.gatewayUrl, token: st.gatewayToken, backup: st.gatewayBackupUrl };
  const gatewayCfg = h(
    'details',
    { class: 'faq' },
    h('summary', null, t('Advanced: your own gateway (optional)')),
    h(
      'div',
      { class: 'stack-sm', style: { paddingBottom: '12px' } },
      h('p', { class: 'muted' }, t('Only if your IT team prefers to keep integration keys on a server it runs in the EU rather than in this encrypted vault. Not needed for any feature.')),
      h('div', { class: 'form-grid' }, field({ label: t('Gateway URL'), value: gw.url, placeholder: 'https://…', onInput: (v) => (gw.url = v.trim()) }), field({ label: t('Backup gateway URL'), value: gw.backup, placeholder: t('optional — another region or provider'), onInput: (v) => (gw.backup = v.trim()) }), field({ label: t('Access token'), type: 'password', value: gw.token, onInput: (v) => (gw.token = v.trim()) })),
      toggle(t('Send WhatsApp through the gateway'), st.whatsappEnabled, (v) => void save({ whatsappEnabled: v })),
      toggle(t('Send email through the gateway'), st.emailViaGateway, (v) => void save({ emailViaGateway: v })),
      field({ label: t('OpenSanctions API key (used by the gateway)'), type: 'password', value: st.openSanctionsKey, onInput: (v) => void saveSettings({ openSanctionsKey: v.trim() }) }),
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
              toast(health ? t('Gateway connected') : gw.url ? t('Saved, but the gateway did not answer: {e}', { e: err ?? '' }) : t('Saved'), health || !gw.url ? 'ok' : 'warn', 6000);
              await drawStates();
            },
          },
          icon('check', 16),
          t('Save and test'),
        ),
        h('button', { class: 'btn', onclick: () => deployHelp() }, icon('book', 16), t('How to deploy the gateway')),
      ),
    ),
  );

  const evalOut = h('div');
  const showEval = (r: EvalSummary) =>
    mount(
      evalOut,
      h(
        'div',
        { class: 'stack-sm' },
        h('div', { class: `callout ${r.passed ? 'ok' : 'danger'}` }, icon(r.passed ? 'check' : 'alert'), t('{c} cases · {e} expected entries · {m} missed · {x} extra · owners {o}% · fields {f}%', { c: r.cases, e: r.expectedEntries, m: r.missed, x: r.extra, o: Math.round(r.ownerAccuracy * 100), f: Math.round(r.fieldAccuracy * 100) })),
        r.results.filter((x) => x.missed.length || x.extra.length || !x.ownersOk || !x.kindOk || !x.dateOk).map((x) => h('div', { class: 'callout warn' }, icon('alert'), h('span', null, h('strong', null, x.name), ` — ${[x.missed.length && `${t('missed')}: ${x.missed.join(', ')}`, x.extra.length && `${t('extra')}: ${x.extra.join(', ')}`, !x.ownersOk && t('owners differ'), !x.kindOk && t('type differs'), !x.dateOk && t('date differs')].filter(Boolean).join(' · ')}`))),
      ),
    );
  const evalCfg = card(
    t('Accuracy evaluation'),
    h(
      'div',
      { class: 'stack-sm' },
      h('p', { class: 'muted' }, t('Measures the document reader against labelled certificates. The release target is zero missed encumbrances. Run it after every update, and add your own anonymised, annotated certificates as a test set.')),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => showEval(evaluate(builtInCases())) }, icon('refresh', 14), t('Run built-in test set')),
        h(
          'button',
          {
            class: 'btn btn-sm',
            onclick: async () => {
              const [f] = await pickFiles('.json,application/json', false);
              if (!f) return;
              try {
                showEval(evaluate(parseTestSet(JSON.parse(await f.text()))));
              } catch (e) {
                toast((e as Error).message, 'error', 7000);
              }
            },
          },
          icon('upload', 14),
          t('Run my test set (JSON)'),
        ),
      ),
      evalOut,
    ),
    { icon: 'scale', help: t('Test set format: {"cases":[{"name":"…","text":"certificate text…","expected":{"issuedOn":"2026-09-01","owners":["…"],"encumbrances":[{"kind":"mortgage","holder":"…"}]}}]}. Everything runs on this device.') },
  );

  void drawStates();
  return h(
    'div',
    { class: 'stack' },
    pageHead(t('Integrations'), t('Every connection in Katharos — what it does, where the data goes, whether it is working right now. Connect and test them here; the core product works fully without any of them.'), h('button', { class: 'btn', onclick: () => void drawStates() }, icon('refresh', 18), t('Re-check all'))),
    card(t('How everything is wired'), diagramHost, { icon: 'layers', help: t('Animated lines are live connections. Client documents only ever go to services inside the EU boundary; WhatsApp carries a neutral status line only; GitHub holds code, never client data.') }),
    statesHost,
    h('h2', null, t('Connect your accounts')),
    h('div', { class: 'callout' }, icon('coins'), h('span', null, t('Each organisation connects its own accounts. Calls go straight from this browser to the provider, and usage is billed by that provider to you — there is no Katharos server in between.'))),
    h('div', { class: 'columns' }, h('div', { class: 'stack' }, aiCfg), h('div', { class: 'stack' }, ocrCfg, evalCfg)),
    msgCfg,
    gatewayCfg,
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
