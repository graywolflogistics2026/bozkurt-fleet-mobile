// Wide-screen (tablet landscape / web, width >= 768) left sidebar —
// PROMPTS.md's Wide-Screen Sidebar design note (owner decision
// 2026-07-04). This is purely an ADDITIONAL presentation of the exact
// same route tree the phone tab bar already drives — no screen is ever
// reachable here that isn't also reachable via the phone tabs/More list.
//
// Group order originally ported verbatim from PROMPTS.md's "Parity
// Checklist" table (Overview/Revenue/Expenses/Business/Intelligence/
// Tools/System); reordered 2026-08-24 (owner decision, device report) to
// Overview/Revenue/Expenses/Tools/Business/Intelligence/System — Tools
// now sits directly under Expenses, ahead of Business, since it's reached
// far more often. This app's own beyond-legacy additions (Other Income,
// Profit Analysis, CEO Mode, Share Weekly Profit, Documents & Renewals,
// Drivers) are appended into whichever group they fit best. See
// navRegistry.ts's own header comment for the actual group order — this
// file just renders it.
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
import { useRouter, usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { NAV_GROUPS, isActiveRoute, type NavItem, type NavGroup } from '@/src/navigation/navRegistry';
import { colors, radii, spacing, typography } from '@/src/theme';
import { BRAND_NAME } from '@/src/brand';
import { BrandWordmark } from '@/src/components/BrandWordmark';

const SIDEBAR_WIDTH = 220;

// NAV PARITY FIX (owner decision 2026-07-30): the actual registry now
// lives in src/navigation/navRegistry.ts, shared by WideSidebar,
// MenuSheet.tsx, the More tab's flat list (app/(tabs)/more/index.tsx),
// and Reports' section filter (app/(tabs)/reports.tsx) — re-exported here
// under their original names purely so those 3 existing import sites
// don't all need to change their import path too.
export type SidebarItem = NavItem;
export type SidebarGroup = NavGroup;
export const GROUPS: SidebarGroup[] = NAV_GROUPS;
export { isActiveRoute };

export function WideSidebar() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { profile, session } = useAuth();

  const companyLabel = profile?.company_name?.trim() || BRAND_NAME;
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
      {/* BRAND REFRESH (owner decision 2026-07-30): logo + name + tagline
          header block — the company name moved out of here (redundant
          with the user-info block below, which already shows it) in
          favor of the tagline, matching the phone top bar's same
          logo+name+tagline treatment. */}
      <View style={{ padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <BrandWordmark fontSize={typography.size.lg} showTagline />
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
            {personLabel || BRAND_NAME}
          </Text>
          <Text style={{ color: colors.muted, fontSize: typography.size.xs }} numberOfLines={1}>
            {companyLabel}
          </Text>
        </View>
      </View>
    </View>
  );
}
