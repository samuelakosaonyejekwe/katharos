import { describe, expect, it } from 'vitest';
import { runRules, sameName, sumShares } from '../src/domain/rules';
import { parseCertificate, parseContract } from '../src/domain/extract';
import { sampleCertificateText, sampleContractText } from '../src/domain/samples';
import { emptyContract, type Certificate, type Matter } from '../src/domain/types';

const pages = (t: string) => [{ page: 1, lines: t.split('\n') }];

function cert(issued: string, memo: boolean, id: string): Certificate {
  const d = parseCertificate(pages(sampleCertificateText(issued, memo)), id);
  return { id, evidenceId: id, ...d, origin: 'downloaded_by_buyer_lawyer', disagreements: [], readBy: ['text', 'ai'], addedAt: issued };
}

function matter(): Matter {
  const contract = { ...emptyContract(), ...parseContract(pages(sampleContractText('2026-09-03', '2026-10-14'))) };
  return {
    id: 'm1', matterRef: '2026-001', firmRef: '', instructedAt: '2026-09-01', status: 'extracted', actsOnlyForBuyer: true, valueBand: 'standard',
    buyer: { name: 'B', email: '', phone: '', lang: 'he', whatsappOptIn: false }, certRequestedAt: null,
    certificates: [cert('2026-09-01', false, 'c1')], contract, releaseRoute: 'unknown', depositStatus: 'unknown', findings: [], findingsComputedAt: null,
    reviews: {}, report: null, evidence: [], events: [], questions: [], checklist: {}, ruleVersion: '', lawAsAt: '', notes: '', updatedAt: '',
  };
}

const keys = (m: Matter, today: string) => runRules(m, today).map((f) => `${f.severity}:${f.msg}`);

describe('rule engine', () => {
  it('helpers', () => {
    expect(sumShares(['1/2', '1/4', '2/8'])).toEqual([1, 1]);
    expect(sumShares(['1/3', '1/3'])).toEqual([2, 3]);
    expect(sameName('Ανδρέας Παπαδόπουλος', 'Andreas Papadopoulos')).toBe(true);
    expect(sameName('Τράπεζα Αιγαίου Λτδ', 'Τράπεζα Αιγαίου Λτδ.')).toBe(true);
    expect(sameName('Μαρία Παπαδοπούλου', 'Ανδρέας Παπαδόπουλος')).toBe(false);
  });
  it('flags the missing co-owner and the wrong payment account, accepts Form A', () => {
    const k = keys(matter(), '2026-09-20');
    expect(k).toContain('red:owners.missing');
    expect(k).toContain('red:payment.mismatch');
    expect(k).toContain('green:mortgage.formA');
    expect(k).toContain('green:date.ok');
    expect(k).toContain('green:cert.ok');
    expect(k).toContain('green:property.ok');
  });
  it('flags a certificate outside five working days', () => {
    const m = matter();
    m.contract.signedOn = '2026-09-14';
    expect(keys(m, '2026-09-20')).toContain('red:date.late');
  });
  it('catches a new memo in the fresh search (Watch)', () => {
    const m = matter();
    m.certificates.push(cert('2026-10-05', true, 'c2'));
    const k = keys(m, '2026-10-06');
    expect(k).toContain('red:watch.new');
    expect(k).toContain('red:watch.newMemo');
    expect(k).toContain('red:memo.found');
    // the fresh search does not replace the certificate attached at signing
    expect(k).toContain('green:date.ok');
    expect(k).not.toContain('red:date.late');
  });
  it('tracks the six-month deposit deadline', () => {
    const m = matter();
    expect(keys(m, '2027-03-10')).toContain('red:deposit.overdue');
    expect(keys(m, '2027-02-20')).toContain('amber:deposit.soon');
    m.contract.depositedOn = '2026-09-10';
    expect(keys(m, '2027-03-10')).toContain('green:deposit.done');
  });
  it('flags Form C and missing Form A', () => {
    const m = matter();
    m.contract.formA = { present: false, lenders: [], account: null, amount: null };
    m.contract.formC = true;
    const k = keys(m, '2026-09-20');
    expect(k).toContain('red:mortgage.noFormA');
    expect(k).toContain('red:formc.signed');
  });
});
