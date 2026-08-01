import { useTranslation } from 'react-i18next';
import type { ShareMessages } from '@/src/components/shareCard/useShareCapture';

// Builds the translated alert strings useShareCapture's shareTo() needs,
// shared across every share-card screen (item F).
export function useShareMessages(): ShareMessages {
  const { t } = useTranslation();
  return {
    notAvailableTitle: t('shareProfit.notAvailableTitle'),
    imageCopiedTitle: t('shareProfit.imageCopiedTitle'),
    imageCopiedBody: (app: string, caption: string) => t('shareProfit.imageCopiedBody', { app, caption }),
    copiedTitle: t('shareProfit.copiedTitle'),
    copiedBody: t('shareProfit.copiedBody'),
    shareFailedTitle: t('shareProfit.shareFailedTitle'),
    tryAgain: t('common.tryAgain'),
  };
}
