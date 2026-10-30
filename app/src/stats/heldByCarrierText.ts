import type { TFunction } from 'i18next';
import { isPrimeCarrier } from '@/src/import/primeOperatingStatement';
import type { HeldByCarrier } from '@/src/stats/heldByCarrier';

// HELD BY CARRIER (owner decision 2026-10-29): the printed balance with its
// as-of date ("Prime holds $600.00 of yours, as of 8/21/2026"); an
// estimate is always labeled as one; never a silent sum.
export function heldByCarrierLines(
  held: HeldByCarrier,
  t: TFunction,
  money: (n: number) => string,
  date: (iso: string) => string
): { headline: string; details: string[] } {
  const carrierName = (c: string | null) => (isPrimeCarrier(c) ? 'Prime' : c?.trim() || t('heldByCarrier.yourCarrier'));
  const accountLine = (a: HeldByCarrier['accounts'][number]) =>
    a.source === 'printed'
      ? t('heldByCarrier.printedOne', { carrier: carrierName(a.carrier), amount: money(a.held), date: date(a.asOf) })
      : t('heldByCarrier.estimateOne', { carrier: carrierName(a.carrier), amount: money(a.held) });
  const details: string[] = [];
  let headline: string;
  if (held.status === 'not_printed' || held.total == null) headline = t('heldByCarrier.notPrinted');
  else if (held.accounts.length === 1) headline = accountLine(held.accounts[0]);
  else {
    headline =
      held.status === 'printed'
        ? t('heldByCarrier.printedMany', { amount: money(held.total), date: date(held.asOf ?? '') })
        : t('heldByCarrier.estimateMany', { amount: money(held.total) });
    details.push(...held.accounts.map(accountLine));
  }
  if (held.unverifiedWeeks.length > 0) details.push(t('heldByCarrier.unverified', { dates: held.unverifiedWeeks.map(date).join(', ') }));
  return { headline, details };
}
