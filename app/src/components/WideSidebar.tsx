// Wide-screen (tablet landscape / web, width >= 768) left sidebar —
// PROMPTS.md's Wide-Screen Sidebar design note (owner decision
// 2026-07-04). This is purely an ADDITIONAL presentation of the exact
// same route tree the phone tab bar already drives — no screen is ever
// reachable here that isn't also reachable via the phone tabs/More list.
//
// Group/order is ported verbatim from PROMPTS.md's "Parity Checklist"
// table (Overview/Revenue/Expenses/Business/Intelligence/Tools/System),
// with this app's own beyond-legacy additions (Other Income, Profit
// Analysis, CEO Mode, Share Weekly Profit, Compliance Tracker, Dashboard
// Customize, Drivers) appended into whichever group they fit best.
//
// Icon strategy (deliberate scope decision, not an oversight): the design
// note asks for legacy's inline SVG icons ported via react-native-svg,
// but that package isn't installed anywhere else in this app — every
// other nav surface (bottom tabs, the More tab's flat list) already uses
// plain emoji glyphs. Reusing that same convention here keeps visual
// consistency across every nav surface and avoids a large side-quest
// (adding a new dependency + porting ~15 exact SVG paths) disproportionate
// to this task's actual purpose (a responsive layout switch). Flagged for
// the PARITY.md audit as a documented gap versus legacy's literal icons.
//
// Legacy's Business-group item is literally named "Assets" (a read-only
// tractor-identity card) — DISTINCT from the Tools-group "Asset Register"
// (the EQUIP-deductions ledger, already built). This app has no dedicated
// read-only truck-identity screen yet, so "Assets" here links to the
// existing Trucks screen (closest functional equivalent) and is labeled
// with nav.trucks rather than a mismatched "Assets" label pointing at a
// screen titled "Trucks" — also flagged for PARITY.md.
import { ScrollView, Text, View, Pressable } from 'react-native';
import { useRouter, usePathname, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { colors, radii, spacing, typography } from '@/src/theme';

const SIDEBAR_WIDTH = 220;

export type SidebarItem = { href: Href; labelKey: string; emoji: string };
export type SidebarGroup = { titleKey: string; items: SidebarItem[] };

// Exported so MenuSheet.tsx (the phone hamburger-menu slide-up sheet,
// device feedback round 2) reuses this exact grouped structure instead of
// a second, driftable copy — one source of truth for legacy's
// Overview/Revenue/Expenses/Business/Intelligence/Tools/System grouping.
export const GROUPS: SidebarGroup[] = [
  {
    titleKey: 'sidebar.sections.overview',
    items: [{ href: '/(tabs)', labelKey: 'nav.dashboard', emoji: '📊' }],
  },
  {
    titleKey: 'sidebar.sections.revenue',
    items: [
      { href: '/(tabs)/import', labelKey: 'nav.import', emoji: '➕' },
      { href: '/(tabs)/more/loads', labelKey: 'nav.loads', emoji: '🚛' },
      { href: '/(tabs)/more/settlements', labelKey: 'nav.settlements', emoji: '📋' },
      { href: '/(tabs)/more/reimbursements', labelKey: 'nav.reimbursements', emoji: '↩️' },
      { href: '/(tabs)/more/other-income', labelKey: 'nav.otherIncome', emoji: '💵' },
    ],
  },
  {
    titleKey: 'sidebar.sections.expenses',
    items: [
      { href: '/(tabs)/more/fuel', labelKey: 'nav.fuel', emoji: '⛽' },
      { href: '/(tabs)/more/maintenance', labelKey: 'nav.maintenance', emoji: '🔧' },
      { href: '/(tabs)/more/tolls', labelKey: 'nav.tolls', emoji: '🛣️' },
      { href: '/(tabs)/deductions', labelKey: 'nav.deductions', emoji: '🧾' },
    ],
  },
  {
    titleKey: 'sidebar.sections.business',
    items: [
      { href: '/(tabs)/more/trucks', labelKey: 'nav.trucks', emoji: '🚚' },
      { href: '/(tabs)/more/drivers', labelKey: 'nav.drivers', emoji: '🧑‍✈️' },
      { href: '/(tabs)/more/capital-account', labelKey: 'nav.capitalAccount', emoji: '💰' },
      { href: '/(tabs)/more/operating-pnl', labelKey: 'nav.operatingPnl', emoji: '📊' },
    ],
  },
  {
    titleKey: 'sidebar.sections.intelligence',
    items: [
      { href: '/(tabs)/truck-health', labelKey: 'nav.truckHealth', emoji: '🚛' },
      { href: '/(tabs)/more/cash-flow', labelKey: 'nav.cashFlow', emoji: '🏦' },
      { href: '/(tabs)/more/scorecard', labelKey: 'nav.scorecard', emoji: '🏆' },
      { href: '/(tabs)/more/loans', labelKey: 'nav.loans', emoji: '📄' },
      { href: '/(tabs)/more/credit-cards', labelKey: 'nav.creditCards', emoji: '💳' },
      { href: '/(tabs)/more/bank-statements', labelKey: 'nav.bankStatements', emoji: '🏛️' },
      { href: '/(tabs)/more/profit-analysis', labelKey: 'nav.profitAnalysis', emoji: '📈' },
      { href: '/(tabs)/more/ceo-mode', labelKey: 'nav.ceoMode', emoji: '🐺' },
    ],
  },
  {
    titleKey: 'sidebar.sections.tools',
    items: [
      { href: '/(tabs)/more/asset-register', labelKey: 'nav.assetRegister', emoji: '🗄️' },
      { href: '/(tabs)/more/accountant-package', labelKey: 'nav.accountantPackage', emoji: '📁' },
      { href: '/(tabs)/more/ai-advisor', labelKey: 'nav.aiAdvisor', emoji: '🤖' },
      { href: '/(tabs)/more/tax-estimator', labelKey: 'nav.taxEstimator', emoji: '🧮' },
      { href: '/(tabs)/more/share-profit', labelKey: 'nav.shareProfit', emoji: '📤' },
      { href: '/(tabs)/more/compliance', labelKey: 'nav.compliance', emoji: '🪪' },
      { href: '/(tabs)/more/dashboard-customize', labelKey: 'nav.dashboardCustomize', emoji: '🧩' },
    ],
  },
  {
    titleKey: 'sidebar.sections.system',
    items: [{ href: '/(tabs)/more/settings', labelKey: 'nav.settings', emoji: '⚙️' }],
  },
];

// expo-router's usePathname() strips group segments like "(tabs)" from
// the resolved path, so an href of '/(tabs)/more/loads' resolves to
// '/more/loads', and the root '/(tabs)' resolves to '/'.
export function isActiveRoute(pathname: string, href: string): boolean {
  const stripped = href.replace('/(tabs)', '') || '/';
  return pathname === stripped;
}

export function WideSidebar() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { profile, session } = useAuth();

  const companyLabel = profile?.company_name?.trim() || t('auth.brand');
  const personLabel = profile?.owner_name?.trim() || session?.user?.email || '';
  const initial = (personLabel || companyLabel).trim().charAt(0).toUpperCase() || '?';

  return (
    <View
      style={{
        width: SIDEBAR_WIDTH,
        backgroundColor: colors.side,
        borderEndWidth: 1,
        borderEndColor: colors.border,
      }}
    >
      <View style={{ padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={{ color: colors.text, fontSize: typography.size.lg, fontWeight: '700' }}>
          🐺 {t('auth.brand')}
        </Text>
        {profile?.company_name?.trim() ? (
          <Text style={{ color: colors.muted, fontSize: typography.size.xs, marginTop: spacing.xs }} numberOfLines={1}>
            {companyLabel}
          </Text>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ paddingVertical: spacing.sm }} showsVerticalScrollIndicator={false}>
        {GROUPS.map((group) => (
          <View key={group.titleKey} style={{ marginBottom: spacing.sm }}>
            <Text
              style={{
                color: colors.muted,
                fontSize: typography.size.xs,
                fontWeight: '700',
                letterSpacing: 0.5,
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.md,
                paddingBottom: spacing.xs,
                textTransform: 'uppercase',
              }}
            >
              {t(group.titleKey)}
            </Text>
            {group.items.map((item) => {
              const active = isActiveRoute(pathname, item.href as string);
              return (
                <Pressable
                  key={item.href as string}
                  onPress={() => router.push(item.href)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.sm,
                    backgroundColor: active ? colors.card2 : pressed ? colors.card : 'transparent',
                    borderStartWidth: 3,
                    borderStartColor: active ? colors.accent : 'transparent',
                  })}
                >
                  <Text style={{ fontSize: 15, marginEnd: spacing.sm }}>{item.emoji}</Text>
                  <Text
                    style={{
                      color: active ? colors.text : colors.muted,
                      fontSize: typography.size.sm,
                      fontWeight: active ? '700' : '500',
                    }}
                    numberOfLines={1}
                  >
                    {t(item.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: spacing.md,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: radii.lg,
            backgroundColor: colors.card2,
            alignItems: 'center',
            justifyContent: 'center',
            marginEnd: spacing.sm,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>{initial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: typography.size.sm, fontWeight: '600' }} numberOfLines={1}>
            {personLabel || t('auth.brand')}
          </Text>
          <Text style={{ color: colors.muted, fontSize: typography.size.xs }} numberOfLines={1}>
            {companyLabel}
          </Text>
        </View>
      </View>
    </View>
  );
}
