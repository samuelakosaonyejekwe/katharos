// Fictitious sample documents (clearly marked) used for the demo matter and the test suite.
import { addDays, addWorkingDays, todayISO } from '../core/dates';

export function sampleDates() {
  const today = todayISO();
  const firstCert = addWorkingDays(today, -40);
  const signed = addWorkingDays(firstCert, 3);
  const freshCert = addWorkingDays(today, -1);
  const nextPayment = addDays(today, 9);
  return { today, firstCert, signed, freshCert, nextPayment };
}

const dmy = (iso: string) => iso.split('-').reverse().join('/');

export function sampleCertificateText(issued: string, withMemo: boolean): string {
  return [
    'ΚΥΠΡΙΑΚΗ ΔΗΜΟΚΡΑΤΙΑ',
    'ΤΜΗΜΑ ΚΤΗΜΑΤΟΛΟΓΙΟΥ ΚΑΙ ΧΩΡΟΜΕΤΡΙΑΣ',
    'ΠΙΣΤΟΠΟΙΗΤΙΚΟ ΕΡΕΥΝΑΣ ΜΕ ΒΑΡΗ ΚΑΙ ΑΠΑΓΟΡΕΥΣΕΙΣ',
    'ΔΕΙΓΜΑ — ΦΑΝΤΑΣΤΙΚΑ ΣΤΟΙΧΕΙΑ / SAMPLE — FICTITIOUS DATA',
    `Ημερομηνία έκδοσης: ${dmy(issued)}`,
    'Επαρχία: Πάφος   Δήμος: Πέγεια',
    'Φύλλο/Σχέδιο: 45/23   Τεμάχιο: 812',
    'Αρ. Εγγραφής: 0/14533   Αρ. Τίτλου: 2219',
    'Περιγραφή: Διαμέρισμα δύο υπνοδωματίων, 1ος όροφος, οριζόντια ιδιοκτησία',
    'ΕΓΓΕΓΡΑΜΜΕΝΟΙ ΙΔΙΟΚΤΗΤΕΣ',
    'Ανδρέας Παπαδόπουλος   Α.Τ. 845521   Μερίδιο 1/2',
    'Μαρία Παπαδοπούλου   Α.Τ. 902117   Μερίδιο 1/2',
    'ΒΑΡΗ ΚΑΙ ΑΠΑΓΟΡΕΥΣΕΙΣ',
    'Υποθήκη αρ. Υ1234/2019 υπέρ Τράπεζα Αιγαίου Λτδ   €180.000   ημερομηνία 14/03/2019',
    ...(withMemo ? [`Μεμό αρ. Μ552/2026 υπέρ Ιωάννης Γεωργίου   €24.500   ημερομηνία ${dmy(addDays(issued, -3))}`] : []),
    'Τέλος πιστοποιητικού',
  ].join('\n');
}

export function sampleContractText(signed: string, nextPayment: string): string {
  return [
    'ΠΩΛΗΤΗΡΙΟ ΕΓΓΡΑΦΟ — SAMPLE / FICTITIOUS',
    `Ημερομηνία υπογραφής: ${dmy(signed)}`,
    'Πωλητής: Ανδρέας Παπαδόπουλος (Α.Τ. 845521)',
    'Αγοραστής: Daniel Cohen (Passport 31877420)',
    'Ακίνητο: Φύλλο/Σχέδιο: 45/23, Τεμάχιο: 812, Αρ. Εγγραφής: 0/14533, Επαρχία Πάφου',
    'Τίμημα: €245.000',
    'Οι πληρωμές καταβάλλονται στον λογαριασμό CY17 0020 0128 0000 0012 0052 7600',
    `Δόση 2: €60.000 μέχρι ${dmy(nextPayment)}`,
    'ΕΝΤΥΠΟ Α',
    'Δανειστής: Τράπεζα Αιγαίου Λτδ',
    'Λογαριασμός αποδέσμευσης: CY21 0020 0195 0000 3570 0123 4567',
    'Ποσό αποδέσμευσης: €180.000',
  ].join('\n');
}
