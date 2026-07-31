import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '@/src/theme';

// CRASH-ON-MOUNT FIX (owner decision 2026-07-30): a screen-level React
// error boundary that renders the error message + component stack ON
// SCREEN instead of only to the console — a crash a developer can only
// see by being plugged into a debugger/log stream is invisible to a
// device tester reporting "it just closes." Ship this FIRST, wrapping
// the entire screen (not just one risky subtree), so any FUTURE crash on
// this screen is immediately visible and reportable instead of a silent
// white-flash-and-return.
//
// This only catches JS errors thrown during React's render/commit/
// lifecycle phases of its children — not errors in event handlers
// (already handled by their own try/catch where relevant, e.g.
// dashboard-customize.tsx's onDragEnd) and not a throw during module
// evaluation/`require()` itself, which happens before any component
// (including this boundary) ever mounts. Guarding against THAT class of
// crash is what src/dashboard/dragModuleLoader.ts's lazy, try/catch-
// wrapped loading is for — the two fixes are complementary, not
// redundant: this boundary is the safety net for everything else that
// could still go wrong after the module successfully loads.
// `title` and `screenName` are pre-localized by the caller (a function
// component, which can call useTranslation() — this class component
// can't use hooks). The error message/stack themselves are never
// localized anywhere in this app (every existing Alert.alert() shows
// `err.message` raw) — they're the runtime's own diagnostic text, not UI
// copy, same treatment here.
type Props = { screenName: string; title: string; children: ReactNode };
type State = { error: Error | null; componentStack: string | null };

export class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    console.log(`[ScreenErrorBoundary:${this.props.screenName}] caught a render-time crash`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <ScrollView
          style={{ flex: 1, backgroundColor: colors.bg }}
          contentContainerStyle={{ padding: spacing.md }}
        >
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
            <Text style={{ color: colors.text, marginBottom: spacing.sm }}>{this.state.error.message}</Text>
            {!!this.state.error.stack && (
              <Text style={{ color: colors.muted, fontSize: typography.size.xs, marginBottom: spacing.sm }}>
                {this.state.error.stack}
              </Text>
            )}
            {!!this.state.componentStack && (
              <Text style={{ color: colors.muted, fontSize: typography.size.xs }}>{this.state.componentStack}</Text>
            )}
          </View>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}
