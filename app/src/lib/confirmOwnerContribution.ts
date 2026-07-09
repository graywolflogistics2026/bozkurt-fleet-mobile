import { Alert } from 'react-native';

// Owner decision 2026-07-07 (CLAUDE.md invariant #2): a personal-payment
// purchase/deduction only becomes a Capital Account contribution after an
// explicit confirmation — declining leaves the deduction saved with no
// linked contribution. Shared by the AI import save flow
// (app/(tabs)/import/index.tsx) and the Deductions edit sheet (Session 7,
// app/(tabs)/deductions.tsx) so both paths ask the same way.
export function confirmOwnerContribution(payMethod: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Add as Owner Contribution?',
      `This was paid with ${payMethod} (personal funds). Record it as a Capital Account contribution?`,
      [
        { text: 'Just Save Deduction', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Add as Owner Contribution', onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });
}
