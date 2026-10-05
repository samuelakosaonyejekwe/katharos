import { describe, expect, it } from 'vitest';
import { fold, parseAmount, parseCertificate, parseContract } from '../src/domain/extract';
import { sampleCertificateText, sampleContractText } from '../src/domain/samples';

const pages = (t: string) => [{ page: 1, lines: t.split('\n') }];

describe('accent folding', () => {
  it('keeps length and strips accents', () => {
    const s = 'Υποθήκη υπέρ Τράπεζας Ά';
    expect(fold(s).length).toBe(s.length);
    expect(fold(s)).toBe('Υποθηκη υπερ Τραπεζας Α');
  });
});

describe('certificate reader', () => {
  const c = parseCertificate(pages(sampleCertificateText('2026-09-01', true)), 'ev1');
  it('reads type, date and property', () => {
    expect(c.kind).toBe('with_encumbrances');
    expect(c.issuedOn).toBe('2026-09-01');
    expect(c.property.district).toBe('Paphos');
    expect(c.property.sheet).toBe('45');
    expect(c.property.plan).toBe('23');
    expect(c.property.parcel).toBe('812');
    expect(c.property.registrationNo).toBe('0/14533');
    expect(c.property.titleNumber).toBe('2219');
    expect(c.separateTitle).toBe(true);
  });
  it('reads owners with accents preserved', () => {
    expect(c.owners.map((o) => o.name)).toEqual(['Ανδρέας Παπαδόπουλος', 'Μαρία Παπαδοπούλου']);
    expect(c.owners.map((o) => o.share)).toEqual(['1/2', '1/2']);
    expect(c.owners[0].idNumber).toBe('845521');
  });
  it('reads every encumbrance and skips the section header', () => {
    expect(c.encumbrances.map((e) => e.kind)).toEqual(['mortgage', 'memo']);
    const [mg, memo] = c.encumbrances;
    expect(mg.holder).toBe('Τράπεζα Αιγαίου Λτδ');
    expect(mg.amount).toBe(180000);
    expect(mg.registeredOn).toBe('2019-03-14');
    expect(mg.reference).toBe('Υ1234/2019');
    expect(memo.holder).toBe('Ιωάννης Γεωργίου');
    expect(memo.amount).toBe(24500);
    expect(c.confidence).toBeGreaterThanOrEqual(0.9);
  });
  it('parses amounts in Cypriot format', () => {
    expect(parseAmount('€180.000')).toBe(180000);
    expect(parseAmount('245.000,50 ευρώ')).toBe(245000.5);
    expect(parseAmount('EUR 1,250,000')).toBe(1250000);
  });
});

describe('contract reader', () => {
  const k = parseContract(pages(sampleContractText('2026-09-03', '2026-10-14')));
  it('reads signing date, price, sellers and Form A', () => {
    expect(k.signedOn).toBe('2026-09-03');
    expect(k.price).toBe(245000);
    expect(k.sellers?.map((s) => s.name)).toEqual(['Ανδρέας Παπαδόπουλος']);
    expect(k.paymentAccount).toBe('CY17002001280000001200527600');
    expect(k.formA?.present).toBe(true);
    expect(k.formA?.lenders).toEqual(['Τράπεζα Αιγαίου Λτδ']);
    expect(k.formA?.account).toBe('CY21002001950000357001234567');
    expect(k.property?.parcel).toBe('812');
  });
});
