// UX MEGA-PASS item F (owner decision 2026-07-31): shared destination list
// for every share-card screen (Share Weekly Profit, AI Coach briefing,
// Scorecard — "same share-card pipeline" per the directive). Extracted
// from app/(tabs)/more/share-profit.tsx's original module-level DESTINATIONS
// constant, extended with WhatsApp, SMS/Messages, and Copy Image (see the
// 'copy' key's own note below — there is no hosted "link" to copy, this
// app has no backend asset URLs per CLAUDE.md invariant #22's "no
// external-data features," so "Copy Link" is implemented as the one
// coherent thing it can mean here: copy the branded image + caption
// straight to the clipboard, ready to paste into literally any app,
// without launching one).
//
// Row order (owner decision 2026-07-30, extended 2026-07-31): Instagram,
// Facebook, X, TikTok, LinkedIn, WhatsApp, SMS/Messages, Driver Pulse,
// Copy Image — "More" is appended after this array by each screen,
// always last.
export type ShareDestination = { key: string; monogram: string; bg: string; fg: string; scheme?: string };

export const SHARE_DESTINATIONS: ShareDestination[] = [
  { key: 'instagram', monogram: 'IG', bg: '#E1306C', fg: '#ffffff', scheme: 'instagram://app' },
  { key: 'facebook', monogram: 'f', bg: '#1877F2', fg: '#ffffff', scheme: 'fb://' },
  { key: 'twitter', monogram: 'X', bg: '#ffffff', fg: '#000000', scheme: 'twitter://' },
  { key: 'tiktok', monogram: 'TT', bg: '#000000', fg: '#ffffff', scheme: 'tiktok://' },
  { key: 'linkedin', monogram: 'in', bg: '#0A66C2', fg: '#ffffff', scheme: 'linkedin://' },
  { key: 'whatsapp', monogram: 'WA', bg: '#25D366', fg: '#ffffff', scheme: 'whatsapp://send' },
  { key: 'sms', monogram: 'SMS', bg: '#34C759', fg: '#ffffff', scheme: 'sms:' },
  { key: 'driverpulse', monogram: 'DP', bg: '#FF5A1F', fg: '#ffffff', scheme: 'driverpulse://' },
  // No `scheme` — handled specially by useShareCapture's shareTo() as a
  // pure clipboard action, never opens an app.
  { key: 'copy', monogram: '📋', bg: '#3A3A44', fg: '#ffffff' },
];
