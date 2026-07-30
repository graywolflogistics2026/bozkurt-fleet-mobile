import { useState } from 'react';
import { Pressable, Text, View, useWindowDimensions, type ColorValue } from 'react-native';
import { Tabs, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { TruckSwitcher } from '@/src/components/TruckSwitcher';
import { CenterImportButton } from '@/src/components/CenterImportButton';
import { ImportActionSheet } from '@/src/components/ImportActionSheet';
import { MenuTabButton } from '@/src/components/MenuTabButton';
import { MenuSheet } from '@/src/components/MenuSheet';
import { WideSidebar } from '@/src/components/WideSidebar';
import { BrandWordmark } from '@/src/components/BrandWordmark';
import { useAlertsData } from '@/src/data/alerts';
import { colors, radii, spacing, typography } from '@/src/theme';

// PROMPTS.md's wide-screen breakpoint — matches legacy's fixed 200px
// #sidebar, which only ever appeared above this width.
const WIDE_BREAKPOINT = 768;

function TabIcon({ emoji, color }: { emoji: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{emoji}</Text>;
}

// Session 9e-B1: Dashboard-only top bar — hamburger (opens MenuSheet,
// state lifted to TabsLayout below) / brand wordmark / notification bell
// (badge = compliance + Truck Health items due, opens the new Alerts
// screen). Every other tab keeps the default TruckSwitcher header
// unchanged.
function DashboardHamburger({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} style={{ paddingHorizontal: spacing.md }}>
      <Text style={{ fontSize: 20, color: colors.text }}>☰</Text>
    </Pressable>
  );
}

// "/(tabs)/more/alerts" (app/(tabs)/more/alerts.tsx, added this pass) is a
// valid route, but expo-router's typed-routes union in .expo/types/
// router.d.ts only regenerates on a dev-server/export run — this explicit
// Href cast is expo-router's own documented escape hatch for a route added
// since the last regen, not a general-purpose `any`.
const ALERTS_ROUTE = '/(tabs)/more/alerts' as Href;

// Owner decision (tablet testing feedback, 2026-07-30): a prominent Import
// action in the top bar, next to the wordmark on both phone AND wide/
// tablet layouts — the wide-screen sidebar has no raised center button
// equivalent (see CenterImportButton.tsx's own note), so wide-screen users
// previously had no shortcut-strength way to start an import at all.
// DESIGN CALL: navigates straight to the import flow rather than
// reopening the center tab's Import/Ask AI chooser sheet — this button is
// explicitly labeled/iconed "Import" (unlike the center "+" button), so
// re-asking "Import or Ask AI?" after a tap on a button that already says
// "Import" would be a labeling mismatch. Ask AI stays reachable via the
// center + button's sheet and the Menu.
function TopBarImportButton({ isWide }: { isWide: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/(tabs)/import')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t('nav.import')}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 44,
          minHeight: 44,
          paddingHorizontal: isWide ? spacing.sm : spacing.xs,
          borderRadius: radii.sm,
          backgroundColor: colors.accent,
          marginEnd: spacing.xs,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={{ fontSize: 18 }}>📥</Text>
      {isWide && (
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: typography.size.sm, marginStart: spacing.xs }}>
          {t('nav.import')}
        </Text>
      )}
    </Pressable>
  );
}

function DashboardBell() {
  const router = useRouter();
  const { count } = useAlertsData();
  return (
    <Pressable onPress={() => router.push(ALERTS_ROUTE)} hitSlop={12} style={{ paddingHorizontal: spacing.md }}>
      <Text style={{ fontSize: 20 }}>🔔</Text>
      {count > 0 && (
        <View
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            minWidth: 15,
            height: 15,
            borderRadius: 8,
            backgroundColor: colors.red,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 3,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

// Tab order (Session 9e-B8 restructure, owner decision — supersedes the
// 2026-07-04 Dashboard/Deductions/[+]/Truck Health/More order): Home ·
// Transactions · [+ Import] (raised center button — importing is the most
// frequent action) · Reports · Menu. Deductions and Truck Health are no
// longer direct tabs but stay fully reachable — Deductions via
// Transactions' expense rows and the Menu sheet's Expenses group; Truck
// Health via the Reports hub's Intelligence group and the Home dashboard's
// Truck Status card — both keep their own route (`href: null` below hides
// them from the tab bar without removing the route).
//
// On width >= 768 (tablet landscape / web) a left WideSidebar replaces
// the bottom tab bar as the primary nav surface (PROMPTS.md's Wide-Screen
// Sidebar design note) — the underlying <Tabs> route tree is completely
// unchanged, only its bottom bar is hidden, so phones are unaffected and
// there is no second set of screens to keep in sync.
export default function TabsLayout() {
  const { t } = useTranslation();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  const tabs = (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.side },
        headerTitleStyle: { color: colors.text },
        headerRight: () => <TruckSwitcher />,
        tabBarStyle: isWide
          ? { display: 'none' }
          : { backgroundColor: colors.side, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.dashboard'),
          tabBarIcon: ({ color }) => <TabIcon emoji="📊" color={color} />,
          headerLeft: () => <DashboardHamburger onPress={() => setMenuOpen(true)} />,
          headerTitle: () => <BrandWordmark />,
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TopBarImportButton isWide={isWide} />
              <DashboardBell />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{ title: t('nav.transactions'), tabBarIcon: ({ color }) => <TabIcon emoji="💳" color={color} /> }}
      />
      <Tabs.Screen
        name="import"
        options={{
          title: t('nav.import'),
          // Session 9d item 11: intercepts the press to open a two-action
          // sheet (Import / Ask AI) instead of navigating straight to the
          // import tab — same pattern as the Menu tab below.
          tabBarButton: (props) => <CenterImportButton {...props} onOpenActionSheet={() => setActionSheetOpen(true)} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{ title: t('nav.reports'), tabBarIcon: ({ color }) => <TabIcon emoji="📈" color={color} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('nav.menu'),
          headerShown: false, // more/_layout.tsx renders its own Stack header
          tabBarIcon: ({ color }) => <TabIcon emoji="☰" color={color} />,
          // Hamburger Menu tab (device feedback round 2): intercepts the
          // press to open MenuSheet's slide-up sheet instead of navigating
          // to the more/ stack directly — every screen it links to is
          // still the same route tree, just reached through a different
          // front door. Wide screens never see this (tab bar hidden,
          // WideSidebar covers the same ground), so menuOpen state below
          // only ever matters on phones.
          tabBarButton: (props) => <MenuTabButton {...props} onOpenMenu={() => setMenuOpen(true)} />,
        }}
      />
      {/* No longer direct tabs (Session 9e-B8) — href: null keeps the
          route navigable (Transactions' expense rows, Menu's Expenses
          group, the Reports hub, Home's Truck Status card) without a
          bottom-tab icon of their own. */}
      <Tabs.Screen name="deductions" options={{ title: t('nav.deductions'), href: null }} />
      <Tabs.Screen name="truck-health" options={{ title: t('nav.truckHealth'), href: null }} />
    </Tabs>
  );

  const withMenuSheet = (
    <>
      {tabs}
      <MenuSheet visible={menuOpen} onClose={() => setMenuOpen(false)} />
      <ImportActionSheet
        visible={actionSheetOpen}
        onClose={() => setActionSheetOpen(false)}
        onImport={() => {
          setActionSheetOpen(false);
          router.push('/(tabs)/import');
        }}
        onAskAi={() => {
          setActionSheetOpen(false);
          router.push('/(tabs)/more/ai-advisor');
        }}
      />
    </>
  );

  if (!isWide) return withMenuSheet;

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
      <WideSidebar />
      <View style={{ flex: 1 }}>{tabs}</View>
    </View>
  );
}
