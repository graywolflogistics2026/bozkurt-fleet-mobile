import { useTranslation } from 'react-i18next';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { MutedText } from '@/src/components/ui';
import { spacing } from '@/src/theme';

// MULTI-TRUCK MODEL (owner decision) — requirement 1's "EVERY screen
// states which scope it's showing. No screen may silently apply its own
// filter." ONE shared component every screen uses, so the wording (and
// the underlying scope value it reads) can never disagree from one
// screen to the next.
//
// `variant="list"` (default) — for a screen whose rows FOLLOW the global
// selector (settlements/loads/fuel/maintenance/tolls/deductions,
// requirement 2's 3rd category). Silent when there's nothing ambiguous to
// state (0 or 1 truck on the account — CLAUDE.md invariant #7's own
// "hide the picker" spirit extends here: with no real choice to make,
// there's nothing to announce).
//
// `variant="fleetOnly"` — for a screen that is ALWAYS fleet-wide
// regardless of the selector (tax estimate, capital account, business
// balance, cash flow, accountant package totals — requirement 2's 1st
// category). Always shown, even for a single-truck account, since the
// point is "this screen ignores the truck selector entirely," not "there
// happen to be multiple trucks right now."
export function FleetScopeLabel({ variant = 'list' }: { variant?: 'list' | 'fleetOnly' }) {
  const { t } = useTranslation();
  const { activeTruck, isAllTrucks, trucks } = useActiveTruck();

  if (variant === 'fleetOnly') {
    return <MutedText style={{ marginBottom: spacing.sm }}>🏢 {t('fleetScope.fleetWideAlways')}</MutedText>;
  }

  if (trucks.length <= 1) return null;

  return (
    <MutedText style={{ marginBottom: spacing.sm }}>
      {isAllTrucks ? `🚛 ${t('fleetScope.showingAllTrucks')}` : `🚚 ${t('fleetScope.showingUnit', { unit: activeTruck?.unit_number ?? '—' })}`}
    </MutedText>
  );
}
