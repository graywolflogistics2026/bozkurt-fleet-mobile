// SUPPORT EMAIL (owner decision 2026-08-05, FULL PARITY follow-up item
// J) — the one shared mailto: URL builder for Settings > Contact
// Support/Report a Problem and ScreenErrorBoundary's "Email This Error"
// button, so both compose an identical, predictable body: app version/
// EAS update id/commit hash/platform/user id — NEVER any financial data
// (settlements, deductions, balances, tax figures). Deliberately a plain
// `mailto:` URL (react-native's own `Linking.openURL`, already used
// elsewhere in this app for the share-card deep link) rather than adding
// a new native dependency like expo-mail-composer.
import { SUPPORT_EMAIL } from '@/src/brand';
import { formatBuildInfoLine, type BuildInfo } from '@/src/lib/buildInfoFormat';

export type SupportEmailContext = {
  subject: string;
  buildInfo: BuildInfo;
  platform: string;
  userId?: string | null;
  screenName?: string | null;
  errorMessage?: string | null;
};

function buildBody(ctx: SupportEmailContext): string {
  const lines = [
    '',
    '',
    '---',
    `Build: ${formatBuildInfoLine(ctx.buildInfo)}`,
    `Platform: ${ctx.platform}`,
  ];
  if (ctx.userId) lines.push(`User ID: ${ctx.userId}`);
  if (ctx.screenName) lines.push(`Screen: ${ctx.screenName}`);
  if (ctx.errorMessage) lines.push(`Error: ${ctx.errorMessage}`);
  return lines.join('\n');
}

// mailto: requires percent-encoding for the subject/body query params —
// encodeURIComponent handles spaces/newlines/special characters safely.
export function buildSupportMailtoUrl(ctx: SupportEmailContext): string {
  const subject = encodeURIComponent(ctx.subject);
  const body = encodeURIComponent(buildBody(ctx));
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}
