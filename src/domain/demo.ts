// Seeds one clearly-marked fictitious matter that exercises every check, the Watch comparison,
// deadlines and the buyer report — so a new user can see the whole flow in a minute.
import { randomId } from '../core/crypto';
import { appendEvent } from './audit';
import { addEvidence, createMatter, saveMatter } from './matters';
import { readCertificate, readContract } from './reader';
import { sampleCertificateText, sampleContractText, sampleDates } from './samples';

export async function seedDemoMatter(): Promise<void> {
  const d = sampleDates();
  const m = await createMatter({
    firmRef: 'SAMPLE-0001',
    buyerName: 'Daniel Cohen (sample)',
    buyerEmail: 'buyer@example.com',
    buyerPhone: '+972500000000',
    buyerLang: 'he',
    actsOnlyForBuyer: true,
    valueBand: 'standard',
  });
  m.notes = 'SAMPLE MATTER — fictitious people, property and banks. Safe to delete.';
  const file = (name: string, text: string) => new File([text], name, { type: 'text/plain' });

  const ev1 = await addEvidence(m, file('sample-search-certificate-1.txt', sampleCertificateText(d.firstCert, false)), 'search_certificate', 'registry');
  await readCertificate(m, ev1, 'downloaded_by_buyer_lawyer');
  const ev2 = await addEvidence(m, file('sample-contract.txt', sampleContractText(d.signed, d.nextPayment)), 'contract', 'firm');
  await readContract(m, ev2);
  m.contract.stagedPayments = [
    { id: randomId('p_'), label: 'Deposit 10%', due: d.signed, amount: 24500, paid: true },
    { id: randomId('p_'), label: 'Second instalment', due: d.nextPayment, amount: 60000, paid: false },
  ];
  // A fresh search before the next payment — it shows a new memo, which Katharos Watch catches.
  const ev3 = await addEvidence(m, file('sample-search-certificate-2.txt', sampleCertificateText(d.freshCert, true)), 'search_certificate', 'registry');
  await readCertificate(m, ev3, 'downloaded_by_buyer_lawyer');
  await appendEvent(m, 'system', 'sample.seeded', {});
  await saveMatter(m);
}
