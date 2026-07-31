import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MutedText, Field, PrimaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { LoanInsert, LoanRow } from '@/src/types/db';

// ASSET PURCHASE & FINANCING (owner decision 2026-07-30, PRODUCT
// DECISION) — shared purchase price/date + cash-or-loan financing block,
// reused identically on the truck (tractor), truck (trailer), and
// Equipment forms. When financing is switched to "loan," the user either
// picks an EXISTING Loan Center loan to link, or fills in the same
// lender/amount/apr/payment/frequency fields ai-import's docType
// "loan_agreement" extracts — "Create & Link" inserts a real `loans` row
// (the SAME table/UI every other loan uses; payments keep flowing
// through the existing principal/interest logic unchanged) and links it.
export type AssetFinancingValue = {
  purchase_price: string;
  purchase_date: string;
  financing: 'cash' | 'loan' | '';
  loan_id: string | null;
};

export function emptyAssetFinancing(): AssetFinancingValue {
  return { purchase_price: '', purchase_date: '', financing: '', loan_id: null };
}

type Props = {
  value: AssetFinancingValue;
  onChange: (v: AssetFinancingValue) => void;
  loans: LoanRow[];
  onCreateLoan: (fields: Omit<LoanInsert, 'user_id'>) => Promise<LoanRow>;
};

export function AssetFinancingFields({ value, onChange, loans, onCreateLoan }: Props) {
  const { t } = useTranslation();
  const [showNewLoanForm, setShowNewLoanForm] = useState(false);
  const [newLoan, setNewLoan] = useState({ lender: '', amount: '', apr: '', payment: '', frequency: '' });
  const [creating, setCreating] = useState(false);

  const linkedLoan = value.loan_id ? loans.find((l) => l.id === value.loan_id) : null;

  async function handleCreateLoan() {
    setCreating(true);
    try {
      const created = await onCreateLoan({
        name: newLoan.lender || null,
        lender: newLoan.lender || null,
        original_amount: newLoan.amount ? Number(newLoan.amount) || null : null,
        balance: newLoan.amount ? Number(newLoan.amount) || null : null,
        apr: newLoan.apr ? Number(newLoan.apr) || null : null,
        payment: newLoan.payment ? Number(newLoan.payment) || null : null,
        frequency: newLoan.frequency || null,
      });
      onChange({ ...value, loan_id: created.id });
      setShowNewLoanForm(false);
      setNewLoan({ lender: '', amount: '', apr: '', payment: '', frequency: '' });
    } catch (err) {
      Alert.alert(t('assetFinancing.createLoanFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <View>
      <MutedText>{t('assetFinancing.purchasePriceLabel')}</MutedText>
      <Field
        keyboardType="numeric"
        value={value.purchase_price}
        onChangeText={(v) => onChange({ ...value, purchase_price: v })}
        placeholder="0"
      />
      <MutedText>{t('assetFinancing.purchaseDateLabel')}</MutedText>
      <Field
        value={value.purchase_date}
        onChangeText={(v) => onChange({ ...value, purchase_date: v })}
        placeholder="YYYY-MM-DD"
      />
      <MutedText>{t('assetFinancing.financingLabel')}</MutedText>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, marginBottom: spacing.xs }}>
        {(['cash', 'loan'] as const).map((option) => (
          <Pressable
            key={option}
            onPress={() => onChange({ ...value, financing: option })}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderRadius: radii.sm,
              borderWidth: 1,
              borderColor: value.financing === option ? colors.accent : colors.border,
              backgroundColor: value.financing === option ? colors.accent : colors.card2,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {option === 'cash' ? t('assetFinancing.cash') : t('assetFinancing.loan')}
            </Text>
          </Pressable>
        ))}
      </View>

      {value.financing === 'loan' && (
        <View style={{ marginTop: spacing.xs }}>
          {linkedLoan ? (
            <View style={{ padding: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.card2 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{linkedLoan.name || linkedLoan.lender || t('assetFinancing.loan')}</Text>
              <MutedText>{t('assetFinancing.linkedLoanHint')}</MutedText>
              <Pressable onPress={() => onChange({ ...value, loan_id: null })} style={{ marginTop: spacing.xs }}>
                <Text style={{ color: colors.orange, fontWeight: '600', fontSize: typography.size.sm }}>{t('assetFinancing.unlink')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {loans.length > 0 && (
                <View style={{ marginBottom: spacing.sm }}>
                  <MutedText>{t('assetFinancing.pickExistingLoan')}</MutedText>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                    {loans.map((l) => (
                      <Pressable
                        key={l.id}
                        onPress={() => onChange({ ...value, loan_id: l.id })}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: radii.sm,
                          borderWidth: 1,
                          borderColor: colors.border,
                          backgroundColor: colors.card2,
                        }}
                      >
                        <Text style={{ color: colors.text, fontSize: typography.size.sm }}>{l.name || l.lender || l.id}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
              {!showNewLoanForm ? (
                <Pressable onPress={() => setShowNewLoanForm(true)}>
                  <Text style={{ color: colors.accent, fontWeight: '600' }}>{t('assetFinancing.enterLoanDetails')}</Text>
                </Pressable>
              ) : (
                <View>
                  <MutedText>{t('assetFinancing.lenderLabel')}</MutedText>
                  <Field value={newLoan.lender} onChangeText={(v) => setNewLoan((f) => ({ ...f, lender: v }))} />
                  <MutedText>{t('assetFinancing.amountLabel')}</MutedText>
                  <Field keyboardType="numeric" value={newLoan.amount} onChangeText={(v) => setNewLoan((f) => ({ ...f, amount: v }))} />
                  <MutedText>{t('assetFinancing.aprLabel')}</MutedText>
                  <Field keyboardType="numeric" value={newLoan.apr} onChangeText={(v) => setNewLoan((f) => ({ ...f, apr: v }))} />
                  <MutedText>{t('assetFinancing.paymentLabel')}</MutedText>
                  <Field keyboardType="numeric" value={newLoan.payment} onChangeText={(v) => setNewLoan((f) => ({ ...f, payment: v }))} />
                  <MutedText>{t('assetFinancing.frequencyLabel')}</MutedText>
                  <Field value={newLoan.frequency} onChangeText={(v) => setNewLoan((f) => ({ ...f, frequency: v }))} placeholder="weekly" />
                  <PrimaryButton title={t('assetFinancing.createAndLink')} onPress={handleCreateLoan} loading={creating} disabled={!newLoan.lender.trim()} />
                </View>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}
