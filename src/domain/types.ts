// The matter record: every stage reads and writes this one shape.

export type Lang = 'en' | 'el' | 'tr' | 'he' | 'fr' | 'zh' | 'ar' | 'pt' | 'es' | 'it' | 'ru' | 'uk';
/** Every language the interface, reports and buyer portal are available in. */
export const ALL_LANGS: Lang[] = ['en', 'el', 'tr', 'he', 'fr', 'zh', 'ar', 'pt', 'es', 'it', 'ru', 'uk'];
export const BUYER_LANGS: Lang[] = ALL_LANGS;
export const RTL: Lang[] = ['he', 'ar'];

export type Severity = 'red' | 'amber' | 'green' | 'info';

export interface SourceRef {
  evidenceId: string;
  page: number;
  line: number;
  text: string;
}

export interface PropertyId {
  district: string | null;
  municipality: string | null;
  sheet: string | null;
  plan: string | null;
  parcel: string | null;
  registrationNo: string | null;
  titleNumber: string | null;
  description: string | null;
}

export interface Owner {
  name: string;
  idNumber: string | null;
  share: string; // "1/2", "1/1"
  source?: SourceRef;
}

export type EncumbranceKind = 'mortgage' | 'memo' | 'prohibition' | 'deposited_contract' | 'lease' | 'easement' | 'other';

export interface Encumbrance {
  id: string;
  kind: EncumbranceKind;
  holder: string;
  amount: number | null;
  registeredOn: string | null; // ISO date
  reference: string | null;
  status: 'active' | 'released' | 'unknown';
  source?: SourceRef;
  needsHuman?: boolean;
}

export type CertKind = 'with_encumbrances' | 'simple' | 'unknown';
export type CertOrigin = 'downloaded_by_buyer_lawyer' | 'supplied_by_seller' | 'unknown';

export interface Certificate {
  id: string;
  evidenceId: string | null;
  kind: CertKind;
  issuedOn: string | null;
  origin: CertOrigin;
  property: PropertyId;
  owners: Owner[];
  encumbrances: Encumbrance[];
  separateTitle: boolean | null;
  handwrittenRegions: number;
  confidence: number; // 0..1
  disagreements: string[]; // fields where the two readings differ
  readBy: string[]; // e.g. ["pdf-text", "ocr-local"], ["azure", "ai"]
  addedAt: string;
}

export interface StagedPayment {
  id: string;
  label: string;
  due: string | null;
  amount: number | null;
  paid: boolean;
}

export interface FormA {
  present: boolean;
  lenders: string[];
  account: string | null; // IBAN named in Form A
  amount: number | null;
}

export interface Contract {
  signedOn: string | null;
  sellers: Owner[];
  property: PropertyId;
  price: number | null;
  paymentAccount: string | null;
  formA: FormA;
  formC: boolean;
  sellerRegisteredOn: string | null;
  depositedOn: string | null;
  stagedPayments: StagedPayment[];
}

export type EvidenceKind =
  | 'search_certificate'
  | 'contract'
  | 'form_a'
  | 'form_c'
  | 'plan'
  | 'permit'
  | 'seller_authority'
  | 'buyer_document'
  | 'signed_report'
  | 'other';

export interface Evidence {
  id: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  source: 'firm' | 'registry' | 'client' | 'other';
  kind: EvidenceKind;
  receivedAt: string;
  pages?: number;
  text?: PageText[]; // reading kept for source-line highlighting
}

export interface PageText {
  page: number;
  lines: string[];
}

export interface AuditEvent {
  seq: number;
  at: string;
  actor: string;
  kind: string;
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface Finding {
  key: string; // stable id: ruleId + subject
  ruleId: string;
  ruleVersion: string;
  severity: Severity;
  msg: string; // message key in the multilingual catalogue
  params: Record<string, string | number>;
  basis: string;
  sources: SourceRef[];
  needsLawyer?: boolean;
}

export type Decision = 'accepted' | 'edited' | 'rejected';

export interface Review {
  decision: Decision;
  note: string;
  by: string;
  at: string;
}

export interface IssuedReport {
  issuedAt: string;
  advocate: string;
  langs: Lang[];
  fingerprint: string; // sha256 of the canonical report content
  ruleVersion: string;
  lawAsAt: string;
  signedEvidenceId: string | null;
  aiAssisted: boolean;
}

export interface BuyerQuestion {
  id: string;
  at: string;
  text: string;
  answer: string | null;
  answeredAt: string | null;
  draftedByAi: boolean;
}

export type MatterStatus = 'instructed' | 'searching' | 'extracted' | 'reviewed' | 'reported' | 'deposited' | 'transferred' | 'closed';
export const STATUSES: MatterStatus[] = ['instructed', 'searching', 'extracted', 'reviewed', 'reported', 'deposited', 'transferred', 'closed'];

export interface Matter {
  id: string;
  matterRef: string;
  firmRef: string;
  instructedAt: string;
  status: MatterStatus;
  actsOnlyForBuyer: boolean | null;
  valueBand: 'standard' | 'high';
  buyer: { name: string; email: string; phone: string; lang: Lang; whatsappOptIn: boolean };
  certRequestedAt: string | null;
  certificates: Certificate[];
  contract: Contract;
  releaseRoute: 'A' | 'B' | 'C' | 'none' | 'unknown';
  depositStatus: 'deposited' | 'not_deposited' | 'unknown';
  findings: Finding[];
  findingsComputedAt: string | null;
  reviews: Record<string, Review>;
  report: IssuedReport | null;
  evidence: Evidence[];
  events: AuditEvent[];
  questions: BuyerQuestion[];
  checklist: Record<string, boolean>;
  ruleVersion: string;
  lawAsAt: string;
  notes: string;
  updatedAt: string;
}

export function emptyProperty(): PropertyId {
  return { district: null, municipality: null, sheet: null, plan: null, parcel: null, registrationNo: null, titleNumber: null, description: null };
}

export function emptyContract(): Contract {
  return {
    signedOn: null,
    sellers: [],
    property: emptyProperty(),
    price: null,
    paymentAccount: null,
    formA: { present: false, lenders: [], account: null, amount: null },
    formC: false,
    sellerRegisteredOn: null,
    depositedOn: null,
    stagedPayments: [],
  };
}
