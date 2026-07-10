import { useTranslation } from 'react-i18next';
import { PlaceholderScreen } from '@/src/components/Placeholder';

export default function Loans() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('placeholders.loans.title')} note={t('placeholders.loans.note')} />;
}
