import { Link, Stack } from "expo-router";
import { Button, Surface } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "页面不存在" }} />
      <Container>
        <View className="flex-1 justify-center items-center p-4">
          <Surface variant="secondary" className="items-center p-6 max-w-sm rounded-lg">
            <Text className="text-4xl mb-3">🤔</Text>
            <Text className="text-foreground font-medium text-lg mb-1">页面不存在</Text>
            <Text className="text-muted text-sm text-center mb-4">
              你访问的页面不存在。
            </Text>
            <Link href="/" asChild>
              <Button size="sm">返回首页</Button>
            </Link>
          </Surface>
        </View>
      </Container>
    </>
  );
}
