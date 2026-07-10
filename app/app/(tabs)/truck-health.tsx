import { useTranslation } from 'react-i18next';
import { PlaceholderScreen } from '@/src/components/Placeholder';

export default function TruckHealth() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('placeholders.truckHealth.title')} note={t('placeholders.truckHealth.note')} />;
}
