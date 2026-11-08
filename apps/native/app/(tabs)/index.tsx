import { GITHUB_SORT_LABELS, GITHUB_SORTS, type GithubSort, PAGE_SIZE } from "@my-better-t-app/api/shared/github";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button, Chip, SearchField, Spinner, useThemeColor } from "heroui-native";
import type React from "react";
import { useCallback, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListMessage, ListSkeleton } from "@/components/github/list-state";
import { ProfileCard } from "@/components/github/profile-card";
import type { GithubProfile } from "@/components/github/types";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { trpc } from "@/utils/trpc";

const SEARCH_DEBOUNCE_MS = 300;

const keyExtractor = (item: GithubProfile) => item.id;
const renderItem = ({ item }: { item: GithubProfile }) => <ProfileCard profile={item} />;
const ItemSeparator = () => <View className="h-3" />;

export default function PeopleScreen() {
  const insets = useSafeAreaInsets();
  const accent = useThemeColor("accent");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<GithubSort>("createdAt");
  const keyword = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const [isPulling, setIsPulling] = useState(false);

  const query = useInfiniteQuery(
    trpc.github.list.infiniteQueryOptions(
      { keyword, sort, limit: PAGE_SIZE },
      { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined }
    )
  );

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const total = query.data?.pages[0]?.total;

  const onRefresh = useCallback(async () => {
    setIsPulling(true);
    try {
      await query.refetch();
    } finally {
      setIsPulling(false);
    }
  }, [query.refetch]);

  const onEndReached = () => {
    if (query.hasNextPage && !query.isFetchingNextPage && !query.isError) {
      query.fetchNextPage();
    }
  };

  const renderEmpty = () => {
    if (query.isPending) {
      return <ListSkeleton />;
    }
    if (query.isError) {
      return (
        <ListMessage
          action={{ label: "重试", onPress: () => query.refetch(), isDisabled: query.isRefetching }}
          description="请检查网络连接或稍后再试"
          icon="cloud-offline-outline"
          title="加载失败"
        />
      );
    }
    if (keyword) {
      return <ListMessage description="换个关键字试试" icon="search-outline" title="没有匹配的人员" />;
    }
    return (
      <ListMessage
        description="请在 Web 端搜索并添加 GitHub 用户"
        icon="people-circle-outline"
        title="系统中还没有 GitHub 人员，请在 Web 端添加"
      />
    );
  };

  const header = (
    <View className="gap-4 pb-4">
      <View className="flex-row items-end justify-between">
        <Text accessibilityRole="header" className="font-bold text-3xl text-foreground">
          GitHub 人员
        </Text>
        {total === undefined ? null : (
          <Text className="pb-1 text-muted text-sm" style={{ fontVariant: ["tabular-nums"] }}>
            {total} 人
          </Text>
        )}
      </View>

      {query.isRefetchError && items.length > 0 ? (
        <Text accessibilityRole="alert" className="text-danger text-sm">
          刷新失败，请下拉重试
        </Text>
      ) : null}

      <SearchField onChange={setSearch} value={search}>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input accessibilityLabel="搜索人员" placeholder="搜索用户名 / 昵称 / 备注" />
          <SearchField.ClearButton accessibilityLabel="清空搜索" />
        </SearchField.Group>
      </SearchField>

      <View accessibilityLabel="排序方式" accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
        {GITHUB_SORTS.map((value) => {
          const selected = value === sort;
          return (
            <Chip
              accessibilityLabel={GITHUB_SORT_LABELS[value]}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              className="min-h-11 justify-center"
              color={selected ? "accent" : "default"}
              key={value}
              onPress={() => setSort(value)}
              variant={selected ? "primary" : "secondary"}
            >
              <Chip.Label>{GITHUB_SORT_LABELS[value]}</Chip.Label>
            </Chip>
          );
        })}
      </View>
    </View>
  );

  let footer: React.ReactElement | null = null;
  if (query.isFetchingNextPage) {
    footer = (
      <View className="items-center py-4">
        <Spinner accessibilityLabel="正在加载更多" />
      </View>
    );
  } else if (query.isFetchNextPageError) {
    // Existing items stay visible, so the empty-state error never shows; offer a retry here.
    footer = (
      <View className="items-center gap-2 py-4">
        <Text className="text-muted text-sm">加载更多失败</Text>
        <Button onPress={() => query.fetchNextPage()} size="sm" variant="secondary">
          <Button.Label>重试</Button.Label>
        </Button>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <FlatList
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
        data={items}
        initialNumToRender={8}
        ItemSeparatorComponent={ItemSeparator}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={keyExtractor}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={footer}
        ListHeaderComponent={header}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl colors={[accent]} onRefresh={onRefresh} refreshing={isPulling} tintColor={accent} />}
        renderItem={renderItem}
        testID="people-list"
        windowSize={7}
      />
    </View>
  );
}
