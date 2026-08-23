import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  useCategoryLearningRules,
  useDeleteCategoryLearningRule,
} from '@/src/data/categoryLearningRules';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { Screen, ScreenTitle, Card, MutedText, SecondaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

// CATEGORY LEARNING LAYER viewer (owner decision 2026-08-05, FULL PARITY
// follow-up item G) — lists every keyword->category rule learned from
// this user's own manual re-categorizations, with per-row delete and a
// "Clear All" action. The explanatory note below is the binding UI
// requirement from the spec: this only adjusts what hints get sent to
// ai-import's prompt for THIS user's own future imports — no model is
// ever trained or fine-tuned on anyone's data.
export default function CategoryLearning() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const rulesQuery = useCategoryLearningRules();
  const deleteRule = useDeleteCategoryLearningRule();

  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const rules = [...(rulesQuery.data ?? [])].sort((a, b) => (b.hit_count ?? 0) - (a.hit_count ?? 0));

  async function onRefresh() {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
      await queryClient.invalidateQueries({ queryKey: ['category_learning_rules'], refetchType: 'all' });
    } finally {
      setRefreshing(false);
    }
  }

  function handleDelete(id: string) {
    Alert.alert(t('categoryLearning.deleteConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setDeletingId(id);
          try {
            await deleteRule.mutateAsync(id);
            await queryClient.invalidateQueries({ queryKey: ['category_learning_rules'] });
          } catch (err) {
            Alert.alert(t('categoryLearning.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  }

  function handleClearAll() {
    if (rules.length === 0) return;
    Alert.alert(t('categoryLearning.clearAllConfirmTitle'), t('categoryLearning.clearAllConfirmBody', { count: rules.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setClearingAll(true);
          try {
            await Promise.all(rules.map((r) => deleteRule.mutateAsync(r.id)));
            await queryClient.invalidateQueries({ queryKey: ['category_learning_rules'] });
          } catch (err) {
            Alert.alert(t('categoryLearning.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
          } finally {
            setClearingAll(false);
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ScreenTitle>{t('categoryLearning.title')}</ScreenTitle>
        <MutedText>{t('categoryLearning.subtitle')}</MutedText>
        <Card>
          <MutedText>{t('categoryLearning.notTrainedNote')}</MutedText>
        </Card>

        {rulesQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : rules.length === 0 ? (
          <Card>
            <MutedText>{t('categoryLearning.empty')}</MutedText>
          </Card>
        ) : (
          <>
            <Card>
              {rules.map((rule, i) => (
                <View
                  key={rule.id}
                  style={[
                    { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
                    i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                  ]}
                >
                  <View style={{ flex: 1, marginEnd: spacing.sm }}>
                    <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                      "{rule.keyword}" → {rule.category}
                    </Text>
                    <MutedText style={{ fontSize: typography.size.xs }}>
                      {t('categoryLearning.hitCount', { count: rule.hit_count ?? 1 })}
                    </MutedText>
                  </View>
                  <Pressable onPress={() => handleDelete(rule.id)} hitSlop={8} disabled={deletingId === rule.id}>
                    <Text style={{ color: colors.red, fontWeight: '700' }}>{deletingId === rule.id ? '…' : '✕'}</Text>
                  </Pressable>
                </View>
              ))}
            </Card>
            <SecondaryButton title={t('categoryLearning.clearAll')} onPress={handleClearAll} loading={clearingAll} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
