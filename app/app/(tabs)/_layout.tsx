import { Text, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { TruckSwitcher } from '@/src/components/TruckSwitcher';
import { CenterImportButton } from '@/src/components/CenterImportButton';
import { colors } from '@/src/theme';

function TabIcon({ emoji, color }: { emoji: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{emoji}</Text>;
}

// Tab order (owner decision 2026-07-04): Dashboard · Deductions ·
// [+ Import] (raised center button — importing is the most frequent
// action) · Truck Health · More. See PROMPTS.md Sessions 5/9.
export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.side },
        headerTitleStyle: { color: colors.text },
        headerRight: () => <TruckSwitcher />,
        tabBarStyle: { backgroundColor: colors.side, borderTopColor: colors.border },
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
          title: t('nav.more'),
          headerShown: false, // more/_layout.tsx renders its own Stack header
          tabBarIcon: ({ color }) => <TabIcon emoji="☰" color={color} />,
        }}
      />
    </Tabs>
  );
}
