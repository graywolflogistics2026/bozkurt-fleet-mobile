import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { callAiAdvisor } from '@/src/data/aiAdvisorCall';
import { Screen, ScreenTitle, MutedText, Field, PrimaryButton, ErrorText } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import i18n from '@/src/i18n';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <View style={{ alignItems: isUser ? 'flex-end' : 'flex-start', marginBottom: spacing.sm }}>
      <View
        style={{
          maxWidth: '85%',
          backgroundColor: isUser ? colors.accent : colors.card,
          borderColor: colors.border,
          borderWidth: isUser ? 0 : 1,
          borderRadius: radii.md,
          padding: spacing.sm,
        }}
      >
        <Text style={{ color: colors.text, fontSize: typography.size.md, lineHeight: 20 }}>{message.content}</Text>
      </View>
    </View>
  );
}

// AI Advisor chat (PROMPTS.md Session 9b item 4) — freeform Q&A against
// the user's own data summary via the ai-advisor Edge Function (that
// function's own system prompt already pulls this account's live
// revenue/deductions/miles server-side, CLAUDE.md invariant #22). The
// full running message history is forwarded on every send (not just the
// latest question) so the model can follow up on earlier turns, same as
// any normal chat.
export default function AiAdvisor() {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    const question = input.trim();
    if (!question || sending) return;
    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    try {
      const result = await callAiAdvisor(nextMessages, i18n.language);
      if (result.error) {
        setError(result.error.message || t('aiAdvisor.failedTitle'));
      } else if (result.data) {
        setMessages((prev) => [...prev, { role: 'assistant', content: result.data as string }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiAdvisor.failedTitle'));
    } finally {
      setSending(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        <ScreenTitle>{t('aiAdvisor.title')}</ScreenTitle>
        <MutedText style={{ marginBottom: spacing.sm }}>{t('aiAdvisor.subtitle')}</MutedText>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 0 ? (
            <MutedText>{t('aiAdvisor.empty')}</MutedText>
          ) : (
            messages.map((m, i) => <Bubble key={i} message={m} />)
          )}
          {sending && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />}
        </ScrollView>

        <ErrorText>{error}</ErrorText>
        <MutedText style={{ marginBottom: spacing.xs }}>{t('profitAnalysis.aiFooter')}</MutedText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Field
            value={input}
            onChangeText={setInput}
            placeholder={t('aiAdvisor.inputPlaceholder')}
            style={{ flex: 1, marginBottom: 0 }}
            onSubmitEditing={handleSend}
          />
        </View>
        <PrimaryButton title={t('aiAdvisor.send')} onPress={handleSend} loading={sending} disabled={!input.trim()} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
