import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Card, Chip, useThemeColor } from "heroui-native";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type ThemeName, useAppTheme } from "@/contexts/app-theme-context";
import { trpc } from "@/utils/trpc";

const THEME_OPTIONS: { value: ThemeName; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "light", label: "浅色", icon: "sunny-outline" },
  { value: "dark", label: "深色", icon: "moon-outline" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="px-1 font-medium text-muted text-xs">{title}</Text>
      <Card className="gap-3 p-4">{children}</Card>
    </View>
  );
}

function ConnectionStatus() {
  const health = useQuery({ ...trpc.healthCheck.queryOptions(), retry: false });
  const success = useThemeColor("success");
  const danger = useThemeColor("danger");
  const muted = useThemeColor("muted");

  let label = "未连接";
  let color = danger;
  let icon: keyof typeof Ionicons.glyphMap = "close-circle";
  if (health.isPending || health.isFetching) {
    label = "检查中…";
    color = muted;
    icon = "time-outline";
  } else if (!health.isError && health.data === "OK") {
    // A failed refetch keeps the cached "OK"; only trust it when the latest check succeeded.
    label = "已连接";
    color = success;
    icon = "checkmark-circle";
  }

  return (
    <View accessibilityLabel={`后端服务 ${label}`} className="flex-row items-center justify-between">
      <Text className="text-base text-foreground">后端服务</Text>
      <View className="flex-row items-center gap-1.5">
        <Ionicons color={color} name={icon} size={18} />
        <Text className="text-sm" style={{ color }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { currentTheme, setTheme } = useAppTheme();
  const version = Constants.expoConfig?.version ?? "—";

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 24, gap: 20 }}
    >
      <Text accessibilityRole="header" className="font-bold text-3xl text-foreground">
        设置
      </Text>

      <Section title="外观">
        <Text className="text-base text-foreground">主题</Text>
        <View accessibilityLabel="主题" accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
          {THEME_OPTIONS.map((option) => {
            const selected = option.value === currentTheme;
            return (
              <Chip
                accessibilityLabel={option.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                aria-checked={selected}
                className="min-h-11 justify-center"
                color={selected ? "accent" : "default"}
                key={option.value}
                onPress={() => setTheme(option.value)}
                variant={selected ? "primary" : "secondary"}
              >
                <Chip.Label>{option.label}</Chip.Label>
              </Chip>
            );
          })}
        </View>
      </Section>

      <Section title="状态">
        <ConnectionStatus />
      </Section>

      <Section title="关于">
        <View className="flex-row items-center justify-between">
          <Text className="text-base text-foreground">版本</Text>
          <Text accessibilityLabel={`版本 ${version}`} className="text-muted text-sm">
            {version}
          </Text>
        </View>
      </Section>
    </ScrollView>
  );
}
