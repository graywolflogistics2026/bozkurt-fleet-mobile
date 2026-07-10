import { useTranslation } from 'react-i18next';
import { PlaceholderScreen } from '@/src/components/Placeholder';

export default function TaxEstimator() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('placeholders.taxEstimator.title')} note={t('placeholders.taxEstimator.note')} />;
}
