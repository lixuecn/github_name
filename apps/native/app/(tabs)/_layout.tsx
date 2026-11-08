import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useThemeColor } from "heroui-native";

export default function TabLayout() {
  const foreground = useThemeColor("foreground");
  const background = useThemeColor("background");
  const accent = useThemeColor("accent");
  const muted = useThemeColor("muted");

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: accent,
        tabBarInactiveTintColor: muted,
        tabBarStyle: { backgroundColor: background },
        tabBarLabelStyle: { fontWeight: "600" },
        sceneStyle: { backgroundColor: background },
        headerTintColor: foreground,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "人员",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons color={color} name={focused ? "people" : "people-outline"} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "设置",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons color={color} name={focused ? "settings" : "settings-outline"} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
