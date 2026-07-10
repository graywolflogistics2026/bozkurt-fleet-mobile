import { useTranslation } from 'react-i18next';
import { PlaceholderScreen } from '@/src/components/Placeholder';

export default function CashFlow() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('placeholders.cashFlow.title')} note={t('placeholders.cashFlow.note')} />;
}
