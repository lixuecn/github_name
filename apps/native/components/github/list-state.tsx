import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Skeleton, useThemeColor } from "heroui-native";
import { Text, View } from "react-native";

const SKELETON_KEYS = ["a", "b", "c", "d"] as const;

export function ProfileCardSkeleton() {
  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-3">
        <Skeleton className="size-12 rounded-full" />
        <View className="flex-1 gap-2">
          <Skeleton className="h-4 w-2/5 rounded-md" />
          <Skeleton className="h-3 w-1/4 rounded-md" />
        </View>
      </View>
      <Skeleton className="h-3 w-full rounded-md" />
      <Skeleton className="h-3 w-3/5 rounded-md" />
    </Card>
  );
}

export function ListSkeleton() {
  return (
    <View accessibilityLabel="正在加载" className="gap-3">
      {SKELETON_KEYS.map((key) => (
        <ProfileCardSkeleton key={key} />
      ))}
    </View>
  );
}

type StateProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void; isDisabled?: boolean };
};

export function ListMessage({ icon, title, description, action }: StateProps) {
  const accent = useThemeColor("accent");
  const accentSoft = useThemeColor("accent-soft");

  return (
    <View className="items-center gap-3 px-6 py-16">
      {/* Layered icon "illustration": a soft disc with the icon on top. */}
      <View className="items-center justify-center rounded-full" style={{ width: 96, height: 96, backgroundColor: accentSoft }}>
        <Ionicons color={accent} name={icon} size={44} />
      </View>
      <Text className="text-center font-semibold text-base text-foreground">{title}</Text>
      {description ? <Text className="text-center text-muted text-sm leading-5">{description}</Text> : null}
      {action ? (
        <Button className="mt-2" isDisabled={action.isDisabled} onPress={action.onPress} size="sm">
          <Button.Label>{action.label}</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}
