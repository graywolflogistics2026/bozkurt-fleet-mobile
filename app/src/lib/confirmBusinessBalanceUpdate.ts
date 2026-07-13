import { Alert } from 'react-native';
import i18n from '@/src/i18n';

// Owner decision 2026-07-12 (Session 9b parity-gap decision #2): legacy's
// checking-statement closing balance SILENTLY overwrites gw_bizbal on
// every render (FEATURE_INVENTORY.md §2.6, rCheckingStmt()) — this app
// requires an explicit confirm instead, every time, never automatic.
// Same "resolve(false)/resolve(true) via a Promise-wrapped Alert" shape
// as confirmOwnerContribution.ts, called outside component render.
export function confirmBusinessBalanceUpdate(closingBalanceLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      i18n.t('confirmBalanceUpdate.title'),
      i18n.t('confirmBalanceUpdate.body', { amount: closingBalanceLabel }),
      [
        { text: i18n.t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: i18n.t('common.save'), onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });
}
