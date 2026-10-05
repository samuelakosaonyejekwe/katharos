// AI model integration: reads page images into a fixed format, explains findings,
// translates and drafts answers. Two transports:
//   gateway — the firm's EU gateway calls Claude through Amazon Bedrock in an EU region (recommended;
//             keeps processing in the EU, "Data protection and location");
//   direct  — this browser calls the Anthropic API with the firm's own key (processing is US/global;
//             the UI warns before enabling it).
// The model never decides a legal check: its output is a second reading, compared against the
// deterministic reader, and every finding is approved by the advocate.
import type Anthropic from '@anthropic-ai/sdk';
import { randomId } from '../core/crypto';
import { settings } from '../core/settings';
import type { CertDraft } from '../domain/extract';
import type { Contract, EncumbranceKind, Lang } from '../domain/types';
import { emptyProperty } from '../domain/types';
import { LANG_NAMES } from '../i18n/messages';
import { blobToBase64, gateway, gatewayConfigured } from './http';

type Params = Anthropic.MessageCreateParamsNonStreaming;
type Msg = Anthropic.Message;

export function aiAvailable(): boolean {
  const s = settings();
  if (s.aiMode === 'bedrock') return Boolean(s.bedrockApiKey);
  if (s.aiMode === 'gateway') return gatewayConfigured();
  if (s.aiMode === 'direct') return Boolean(s.anthropicKey);
  return false;
}

let directClient: Anthropic | null = null;
let directKey = '';

async function direct(): Promise<Anthropic> {
  const key = settings().anthropicKey;
  if (!directClient || directKey !== key) {
    const { default: AnthropicSdk } = await import('@anthropic-ai/sdk');
    directClient = new AnthropicSdk({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 180_000 });
    directKey = key;
  }
  return directClient;
}

function retryable(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  return status === undefined || status === 429 || status === 529 || status >= 500;
}

let bedrockClient: { client: { messages: Anthropic['messages'] }; sig: string } | null = null;

/** The organisation's own Bedrock account, called from this browser in an EU region — no server in between. */
async function bedrock(): Promise<{ messages: Anthropic['messages'] }> {
  const s = settings();
  const sig = `${s.bedrockRegion}|${s.bedrockApiKey}`;
  if (!bedrockClient || bedrockClient.sig !== sig) {
    const { AnthropicBedrockMantle } = await import('@anthropic-ai/bedrock-sdk');
    const client = new AnthropicBedrockMantle({ awsRegion: s.bedrockRegion, apiKey: s.bedrockApiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 240_000 } as never);
    bedrockClient = { client: client as unknown as { messages: Anthropic['messages'] }, sig };
  }
  return bedrockClient.client;
}

async function send(params: Params): Promise<Msg> {
  const mode = settings().aiMode;
  if (mode === 'bedrock') return (await bedrock()).messages.create({ ...params, model: `anthropic.${params.model.replace(/^(eu\.|global\.)?anthropic\./, '')}` }) as Promise<Msg>;
  if (mode === 'gateway') return gateway<Msg>('/v1/messages', params, { timeoutMs: 240_000 });
  return (await direct()).messages.create(params);
}

/** Primary model, then the backup model on overload, outage or refusal. */
async function create(params: Omit<Params, 'model'>): Promise<Msg> {
  const s = settings();
  const models = [s.aiModel, s.aiBackupModel].filter(Boolean);
  let last: unknown;
  for (const model of models) {
    try {
      const res = await send({ ...params, model } as Params);
      if (res.stop_reason === 'refusal') {
        last = new Error('The model declined this request');
        continue;
      }
      return res;
    } catch (e) {
      last = e;
      const status = (e as { status?: number })?.status;
      if (status === 401 || status === 403) throw new Error(`The AI provider rejected the key (HTTP ${status}). Check the key, the region and that Claude model access is enabled.`);
      if (!retryable(e)) throw e;
    }
  }
  throw last instanceof Error ? last : new Error('AI request failed');
}

function textOf(m: Msg): string {
  return m.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

async function fileBlock(file: Blob): Promise<Anthropic.ContentBlockParam> {
  const data = await blobToBase64(file);
  if (file.type === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  const mt = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type) ? file.type : 'image/png') as 'image/png';
  return { type: 'image', source: { type: 'base64', media_type: mt, data } };
}

const N_STR = { type: ['string', 'null'] };
const N_NUM = { type: ['number', 'null'] };

const PROPERTY = {
  type: 'object',
  additionalProperties: false,
  required: ['district', 'municipality', 'sheet', 'plan', 'parcel', 'registration_no', 'title_number', 'description'],
  properties: { district: N_STR, municipality: N_STR, sheet: N_STR, plan: N_STR, parcel: N_STR, registration_no: N_STR, title_number: N_STR, description: N_STR },
};

const PERSON = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'id_number', 'share'],
  properties: { name: { type: 'string' }, id_number: N_STR, share: N_STR },
};

// Strict schema: the response matches the stored shape or fails loudly; unreadable → null.
const CERT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'issued_on', 'property', 'owners', 'encumbrances', 'separate_title', 'handwritten_regions', 'confidence'],
  properties: {
    kind: { type: 'string', enum: ['with_encumbrances', 'simple', 'unknown'] },
    issued_on: N_STR,
    property: PROPERTY,
    owners: { type: 'array', items: PERSON },
    encumbrances: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'holder', 'amount', 'registered_on', 'reference', 'status', 'page', 'quote'],
        properties: {
          kind: { type: 'string', enum: ['mortgage', 'memo', 'prohibition', 'deposited_contract', 'lease', 'easement', 'other'] },
          holder: { type: 'string' },
          amount: N_NUM,
          registered_on: N_STR,
          reference: N_STR,
          status: { type: 'string', enum: ['active', 'released', 'unknown'] },
          page: { type: ['integer', 'null'] },
          quote: N_STR,
        },
      },
    },
    separate_title: { type: ['boolean', 'null'] },
    handwritten_regions: { type: 'integer' },
    confidence: { type: 'number' },
  },
};

const CONTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['signed_on', 'sellers', 'price', 'payment_account', 'form_a', 'form_c', 'seller_registered_on', 'property', 'staged_payments'],
  properties: {
    signed_on: N_STR,
    sellers: { type: 'array', items: PERSON },
    price: N_NUM,
    payment_account: N_STR,
    form_a: {
      type: 'object',
      additionalProperties: false,
      required: ['present', 'lenders', 'account', 'amount'],
      properties: { present: { type: 'boolean' }, lenders: { type: 'array', items: { type: 'string' } }, account: N_STR, amount: N_NUM },
    },
    form_c: { type: 'boolean' },
    seller_registered_on: N_STR,
    property: PROPERTY,
    staged_payments: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['label', 'due', 'amount'], properties: { label: { type: 'string' }, due: N_STR, amount: N_NUM } },
    },
  },
};

// Stable system prompts first, so prompt caching applies across documents.
const READER_SYSTEM = `You read Cypriot Department of Lands and Surveys (Land Registry) documents and sale contracts, written in Greek or English, for a conveyancing advocate.
Rules:
- Extract only what is legible on the page. Never infer, complete or guess a value. Anything you cannot read with certainty is null.
- Dates as YYYY-MM-DD. Cypriot documents write dates day-first (05/03/2026 is 5 March 2026).
- Amounts as plain numbers in euro, no separators.
- Keep names exactly as written, in the original script.
- For each encumbrance give the page number and a short verbatim quote of the line it came from.
- "Μεμό"/"memo" is a judgment creditor's charge; "Απαγόρευση" is a prohibition; "Υποθήκη" is a mortgage; a deposited "Πωλητήριο Έγγραφο" is a deposited sale contract.
- Count every region with handwriting, a handwritten annotation, stamp text or initials in handwritten_regions. Greek handwriting is never transcribed into fields.
- confidence is your overall certainty (0 to 1) that every non-null field is correct.
- You are not giving legal advice; the advocate decides.`;

function fromCertJson(j: Record<string, any>): CertDraft {
  const p = j.property ?? {};
  return {
    kind: j.kind ?? 'unknown',
    issuedOn: j.issued_on ?? null,
    property: {
      ...emptyProperty(),
      district: p.district ?? null,
      municipality: p.municipality ?? null,
      sheet: p.sheet ?? null,
      plan: p.plan ?? null,
      parcel: p.parcel ?? null,
      registrationNo: p.registration_no ?? null,
      titleNumber: p.title_number ?? null,
      description: p.description ?? null,
    },
    owners: (j.owners ?? []).map((o: any) => ({ name: o.name, idNumber: o.id_number ?? null, share: o.share ?? '1/1' })),
    encumbrances: (j.encumbrances ?? []).map((e: any) => ({
      id: randomId('e_'),
      kind: e.kind as EncumbranceKind,
      holder: e.holder,
      amount: e.amount ?? null,
      registeredOn: e.registered_on ?? null,
      reference: e.reference ?? null,
      status: e.status ?? 'unknown',
      source: e.quote ? { evidenceId: '', page: e.page ?? 1, line: 0, text: e.quote } : undefined,
      needsHuman: !e.registered_on,
    })),
    separateTitle: j.separate_title ?? null,
    handwrittenRegions: j.handwritten_regions ?? 0,
    confidence: typeof j.confidence === 'number' ? Math.max(0, Math.min(1, j.confidence)) : 0.5,
  };
}

export async function aiReadCertificate(file: Blob, evidenceId: string): Promise<CertDraft> {
  const res = await create({
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: CERT_SCHEMA } },
    system: [{ type: 'text', text: READER_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [await fileBlock(file), { type: 'text', text: 'This is a Land Registry search certificate. Extract the fields. Do not infer anything that is not legible. Count handwritten regions.' }] }],
  } as Omit<Params, 'model'>);
  const draft = fromCertJson(JSON.parse(textOf(res)));
  draft.encumbrances.forEach((e) => e.source && (e.source.evidenceId = evidenceId));
  return draft;
}

export async function aiReadContract(file: Blob): Promise<Partial<Contract>> {
  const res = await create({
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: CONTRACT_SCHEMA } },
    system: [{ type: 'text', text: READER_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [await fileBlock(file), { type: 'text', text: 'This is a sale contract (possibly with Form A or Form C attached). Extract the fields.' }] }],
  } as Omit<Params, 'model'>);
  const j = JSON.parse(textOf(res));
  const p = j.property ?? {};
  return {
    signedOn: j.signed_on,
    sellers: (j.sellers ?? []).map((o: any) => ({ name: o.name, idNumber: o.id_number ?? null, share: o.share ?? '1/1' })),
    price: j.price,
    paymentAccount: j.payment_account,
    formA: { present: j.form_a?.present ?? false, lenders: j.form_a?.lenders ?? [], account: j.form_a?.account ?? null, amount: j.form_a?.amount ?? null },
    formC: Boolean(j.form_c),
    sellerRegisteredOn: j.seller_registered_on,
    property: { ...emptyProperty(), district: p.district, municipality: p.municipality, sheet: p.sheet, plan: p.plan, parcel: p.parcel, registrationNo: p.registration_no, titleNumber: p.title_number, description: p.description },
    stagedPayments: (j.staged_payments ?? []).map((s: any) => ({ id: randomId('p_'), label: s.label, due: s.due, amount: s.amount, paid: false })),
  };
}

const EXPLAIN_SYSTEM = `You help a Cypriot conveyancing advocate explain an approved title report to their client in plain language.
- Write for a non-lawyer who may be reading in a second language. Short sentences, no jargon; explain Greek terms in brackets.
- Only restate the findings you are given. Do not add facts, advice, opinions or reassurance that the findings do not contain.
- End with a short list of questions the buyer may want to ask their advocate.
- This text is a draft: the advocate reviews and sends it.`;

export async function aiExplain(findings: string[], lang: Lang): Promise<string> {
  const res = await create({
    max_tokens: 4000,
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: EXPLAIN_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Language: ${LANG_NAMES[lang]}.\nApproved findings:\n${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}` }],
  } as Omit<Params, 'model'>);
  return textOf(res).trim();
}

export async function aiDraftAnswer(question: string, findings: string[], lang: Lang): Promise<string> {
  const res = await create({
    max_tokens: 3000,
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: `${EXPLAIN_SYSTEM}\n- You are drafting a reply to the client's question for the advocate to edit. If the findings do not answer it, say the advocate will confirm.`, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Reply in ${LANG_NAMES[lang]}.\nFindings:\n${findings.join('\n')}\n\nClient question:\n${question}` }],
  } as Omit<Params, 'model'>);
  return textOf(res).trim();
}

/** A minimal call to prove the AI path works end to end (used by the Integrations screen). */
export async function aiPing(): Promise<string> {
  const res = await create({ max_tokens: 200, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] } as Omit<Params, 'model'>);
  return `${res.model}: ${textOf(res).trim()}`;
}
