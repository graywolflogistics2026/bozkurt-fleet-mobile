import { useTranslation } from 'react-i18next';
import { PlaceholderScreen } from '@/src/components/Placeholder';

export default function Maintenance() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('placeholders.maintenance.title')} note={t('placeholders.maintenance.note')} />;
}
