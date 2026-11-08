import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { Card, Chip, useThemeColor } from "heroui-native";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";

import { formatCount } from "@/lib/format";

import type { GithubProfile } from "./types";

const AVATAR_SIZE = 48;

function Stat({ icon, value, label }: { icon: keyof typeof Ionicons.glyphMap; value: number; label: string }) {
  const muted = useThemeColor("muted");
  return (
    <View accessibilityLabel={`${label} ${value}`} className="flex-row items-center gap-1">
      <Ionicons color={muted} name={icon} size={14} />
      <Text className="font-semibold text-foreground text-sm" style={{ fontVariant: ["tabular-nums"] }}>
        {formatCount(value)}
      </Text>
      <Text className="text-muted text-xs">{label}</Text>
    </View>
  );
}

function ProfileCardBase({ profile }: { profile: GithubProfile }) {
  const muted = useThemeColor("muted");
  const surface = useThemeColor("surface-secondary");
  const displayName = profile.name ?? profile.login;
  const place = [profile.company, profile.location].filter(Boolean);

  return (
    <Pressable
      accessibilityHint="在浏览器中打开"
      accessibilityLabel={`打开 ${profile.login} 的 GitHub 主页`}
      accessibilityRole="link"
      className="active:opacity-80"
      onPress={() => WebBrowser.openBrowserAsync(profile.htmlUrl)}
      testID={`profile-card-${profile.login}`}
    >
      <Card className="gap-3 p-4">
        <View className="flex-row items-center gap-3">
          <Image
            accessibilityIgnoresInvertColors
            alt={`${profile.login} 的头像`}
            cachePolicy="memory-disk"
            contentFit="cover"
            recyclingKey={profile.id}
            source={profile.avatarUrl}
            style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: surface }}
            transition={150}
          />
          <View className="min-w-0 flex-1">
            <Text className="font-bold text-base text-foreground" numberOfLines={1}>
              {displayName}
            </Text>
            <Text className="text-muted text-sm" numberOfLines={1}>
              @{profile.login}
            </Text>
          </View>
          <Ionicons color={muted} name="arrow-up-outline" size={18} style={{ transform: [{ rotate: "45deg" }] }} />
        </View>

        {profile.bio ? (
          <Text className="text-foreground text-sm leading-5" numberOfLines={2}>
            {profile.bio}
          </Text>
        ) : null}

        {place.length > 0 ? (
          <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
            {profile.company ? (
              <View className="flex-row items-center gap-1">
                <Ionicons color={muted} name="business-outline" size={14} />
                <Text className="text-muted text-xs" numberOfLines={1}>
                  {profile.company}
                </Text>
              </View>
            ) : null}
            {profile.location ? (
              <View className="flex-row items-center gap-1">
                <Ionicons color={muted} name="location-outline" size={14} />
                <Text className="text-muted text-xs" numberOfLines={1}>
                  {profile.location}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View className="flex-row flex-wrap gap-4">
          <Stat icon="people-outline" label="粉丝" value={profile.followers} />
          <Stat icon="cube-outline" label="仓库" value={profile.publicRepos} />
          <Stat icon="person-add-outline" label="关注" value={profile.following} />
        </View>

        {profile.tags.length > 0 ? (
          <View className="flex-row flex-wrap gap-1.5">
            {profile.tags.map((tag) => (
              <Chip key={tag} size="sm" variant="soft">
                <Chip.Label>{tag}</Chip.Label>
              </Chip>
            ))}
          </View>
        ) : null}

        {profile.note ? (
          <Text className="text-muted text-xs" numberOfLines={1}>
            备注：{profile.note}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
}

export const ProfileCard = memo(ProfileCardBase);
