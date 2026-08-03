import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { colors, radii, spacing, typography } from '@/src/theme';
import { getBuildInfo, formatBuildInfoLine } from '@/src/lib/buildInfo';

// CRASH-ON-MOUNT FIX (owner decision 2026-07-30): a screen-level React
// error boundary that renders the error message + component stack ON
// SCREEN instead of only to the console — a crash a developer can only
// see by being plugged into a debugger/log stream is invisible to a
// device tester reporting "it just closes." Ship this FIRST, wrapping
// the entire screen (not just one risky subtree), so any FUTURE crash on
// this screen is immediately visible and reportable instead of a silent
// white-flash-and-return.
//
// DARK-THEME AUDIT (owner decision 2026-07-30, device evidence: a
// PERSISTENT white screen after the crash-on-mount fix landed): every
// color here already came from theme.ts's dark palette — nothing was
// ever hardcoded white — but the OUTER container is now an explicit
// `flex: 1` View with `colors.bg` behind the ScrollView too (not just
// on the ScrollView's own style), so the dark background is guaranteed
// to paint the full screen even if the ScrollView's content is short and
// some ancestor in the navigator's flex chain doesn't stretch it. This
// is a defensive reinforcement, not a fix for a located bug.
//
// This only catches JS errors thrown during React's render/commit/
// lifecycle phases of its children — not errors in event handlers
// (already handled by their own try/catch where relevant) and not a
// throw during module evaluation/`require()` itself, which happens
// before any component (including this boundary) ever mounts. This
// component was originally paired with a lazy, try/catch-wrapped module
// loader (src/dashboard/dragModuleLoader.ts) on the now-retired Customize
// Dashboard screen (DASHBOARD SIMPLIFICATION, owner decision 2026-08-02
// — that screen and loader are deleted) — this boundary itself stays as
// a reusable, generic safety net for any other screen with a similarly
// risky dependency.
//
// `title`/`copyLabel`/`copiedLabel` are pre-localized by the caller (a
// function component, which can call useTranslation() — this class
// component can't use hooks). The error message/stack/build info line
// themselves are never localized anywhere in this app (every existing
// Alert.alert() shows `err.message` raw) — they're diagnostic text, not
// UI copy, same treatment here.
type Props = { screenName: string; title: string; copyLabel: string; copiedLabel: string; children: ReactNode };
type State = { error: Error | null; componentStack: string | null; copied: boolean };

export class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, copied: false };
  copiedTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    console.log(`[ScreenErrorBoundary:${this.props.screenName}] caught a render-time crash`, error, info.componentStack);
  }

  componentWillUnmount() {
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
  }

  handleCopy = async () => {
    const { error, componentStack } = this.state;
    if (!error) return;
    // RUNTIME VISIBILITY (owner decision 2026-07-30): the copied report
    // includes build info so a device bug report always carries "which
    // JS is on this device" alongside the error itself.
    const report = [
      `Screen: ${this.props.screenName}`,
      `Build: ${formatBuildInfoLine(getBuildInfo())}`,
      `Error: ${error.message}`,
      error.stack ? `Stack:\n${error.stack}` : null,
      componentStack ? `Component stack:${componentStack}` : null,
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      await Clipboard.setStringAsync(report);
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.setState({ copied: true });
      this.copiedTimer = setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Clipboard failing is not itself worth crashing over or showing a
      // second error UI for — the error/stack text is still selectable
      // and readable on screen regardless.
    }
  };

  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.md }}>
            <View
              style={{
                backgroundColor: colors.card,
                borderColor: colors.red,
                borderWidth: 1,
                borderRadius: radii.md,
                padding: spacing.md,
              }}
            >
              <Text style={{ color: colors.red, fontWeight: '700', fontSize: typography.size.lg, marginBottom: spacing.sm }}>
                {this.props.title}
              </Text>
              <Text style={{ color: colors.muted, fontSize: typography.size.xs, marginBottom: spacing.md }}>
                {formatBuildInfoLine(getBuildInfo())}
              </Text>
              <Text style={{ color: colors.text, marginBottom: spacing.sm }}>{this.state.error.message}</Text>
              {!!this.state.error.stack && (
                <Text style={{ color: colors.muted, fontSize: typography.size.xs, marginBottom: spacing.sm }}>
                  {this.state.error.stack}
                </Text>
              )}
              {!!this.state.componentStack && (
                <Text style={{ color: colors.muted, fontSize: typography.size.xs, marginBottom: spacing.md }}>
                  {this.state.componentStack}
                </Text>
              )}
              <Pressable
                onPress={this.handleCopy}
                style={({ pressed }) => ({
                  alignSelf: 'flex-start',
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderRadius: radii.sm,
                  borderWidth: 1,
                  borderColor: colors.accent,
                  backgroundColor: pressed ? colors.card2 : 'transparent',
                })}
              >
                <Text style={{ color: colors.accent, fontWeight: '700' }}>
                  {this.state.copied ? this.props.copiedLabel : this.props.copyLabel}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}
