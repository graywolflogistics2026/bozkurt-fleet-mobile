import { Text, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { TruckSwitcher } from '@/src/components/TruckSwitcher';
import { colors } from '@/src/theme';

function TabIcon({ emoji, color }: { emoji: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{emoji}</Text>;
}

export default function TabsLayout() {
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
        options={{ title: 'Dashboard', tabBarIcon: ({ color }) => <TabIcon emoji="📊" color={color} /> }}
      />
      <Tabs.Screen
        name="import"
        options={{ title: 'Import', tabBarIcon: ({ color }) => <TabIcon emoji="📥" color={color} /> }}
      />
      <Tabs.Screen
        name="deductions"
        options={{ title: 'Deductions', tabBarIcon: ({ color }) => <TabIcon emoji="🧾" color={color} /> }}
      />
      <Tabs.Screen
        name="truck-health"
        options={{ title: 'Truck Health', tabBarIcon: ({ color }) => <TabIcon emoji="🚛" color={color} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          headerShown: false, // more/_layout.tsx renders its own Stack header
          tabBarIcon: ({ color }) => <TabIcon emoji="☰" color={color} />,
        }}
      />
    </Tabs>
  );
}
