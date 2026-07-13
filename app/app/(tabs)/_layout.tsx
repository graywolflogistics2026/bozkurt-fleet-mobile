import { useState } from 'react';
import { Text, View, useWindowDimensions, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { TruckSwitcher } from '@/src/components/TruckSwitcher';
import { CenterImportButton } from '@/src/components/CenterImportButton';
import { MenuTabButton } from '@/src/components/MenuTabButton';
import { MenuSheet } from '@/src/components/MenuSheet';
import { WideSidebar } from '@/src/components/WideSidebar';
import { colors } from '@/src/theme';

// PROMPTS.md's wide-screen breakpoint — matches legacy's fixed 200px
// #sidebar, which only ever appeared above this width.
const WIDE_BREAKPOINT = 768;

function TabIcon({ emoji, color }: { emoji: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{emoji}</Text>;
}

// Tab order (owner decision 2026-07-04): Dashboard · Deductions ·
// [+ Import] (raised center button — importing is the most frequent
// action) · Truck Health · More. See PROMPTS.md Sessions 5/9.
//
// On width >= 768 (tablet landscape / web) a left WideSidebar replaces
// the bottom tab bar as the primary nav surface (PROMPTS.md's Wide-Screen
// Sidebar design note) — the underlying <Tabs> route tree is completely
// unchanged, only its bottom bar is hidden, so phones are unaffected and
// there is no second set of screens to keep in sync.
export default function TabsLayout() {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const [menuOpen, setMenuOpen] = useState(false);

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
        options={{ title: t('nav.dashboard'), tabBarIcon: ({ color }) => <TabIcon emoji="📊" color={color} /> }}
      />
      <Tabs.Screen
        name="deductions"
        options={{ title: t('nav.deductions'), tabBarIcon: ({ color }) => <TabIcon emoji="🧾" color={color} /> }}
      />
      <Tabs.Screen
        name="import"
        options={{
          title: t('nav.import'),
          tabBarButton: (props) => <CenterImportButton {...props} />,
        }}
      />
      <Tabs.Screen
        name="truck-health"
        options={{ title: t('nav.truckHealth'), tabBarIcon: ({ color }) => <TabIcon emoji="🚛" color={color} /> }}
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
    </Tabs>
  );

  const withMenuSheet = (
    <>
      {tabs}
      <MenuSheet visible={menuOpen} onClose={() => setMenuOpen(false)} />
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
