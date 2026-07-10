import { Alert } from 'react-native';
import i18n from '@/src/i18n';

// Owner decision 2026-07-07 (CLAUDE.md invariant #2): a personal-payment
// purchase/deduction only becomes a Capital Account contribution after an
// explicit confirmation — declining leaves the deduction saved with no
// linked contribution. Shared by the AI import save flow
// (app/(tabs)/import/index.tsx) and the Deductions edit sheet (Session 7,
// app/(tabs)/deductions.tsx) so both paths ask the same way. Called outside
// component render, so it reads the i18next instance directly (i18n.t)
// rather than the useTranslation() hook.
export function confirmOwnerContribution(payMethod: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      i18n.t('confirmContribution.title'),
      i18n.t('confirmContribution.body', { method: payMethod }),
      [
        { text: i18n.t('confirmContribution.justSave'), style: 'cancel', onPress: () => resolve(false) },
        { text: i18n.t('confirmContribution.addContribution'), onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });
}
