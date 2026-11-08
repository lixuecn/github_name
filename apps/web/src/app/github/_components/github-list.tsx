"use client";

import { GITHUB_SORT_LABELS, GITHUB_SORTS, type GithubSort, PAGE_SIZE } from "@my-better-t-app/api/shared/github";
import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@my-better-t-app/ui/components/empty";
import { Input } from "@my-better-t-app/ui/components/input";
import { Label } from "@my-better-t-app/ui/components/label";
import { Skeleton } from "@my-better-t-app/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@my-better-t-app/ui/components/table";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useId, useState } from "react";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatCount, formatRelativeTime } from "@/lib/format";
import { useTRPC } from "@/utils/trpc";

import { GithubAvatar } from "./avatar";
import { GithubRowActions } from "./github-row-actions";
import type { GithubProfile } from "./types";

const KEYWORD_DEBOUNCE_MS = 300;
const SKELETON_ROWS = ["a", "b", "c"] as const;

type Pager = { filterKey: string; cursors: (string | null)[] };

export function GithubList() {
  const trpc = useTRPC();
  const keywordId = useId();
  const sortId = useId();
  const [keywordInput, setKeywordInput] = useState("");
  const [sort, setSort] = useState<GithubSort>("createdAt");
  const keyword = useDebouncedValue(keywordInput.trim(), KEYWORD_DEBOUNCE_MS);

  // Pagination resets whenever the filter or sort changes.
  const filterKey = `${keyword}\u0000${sort}`;
  const [pager, setPager] = useState<Pager>({ filterKey, cursors: [null] });
  if (pager.filterKey !== filterKey) {
    // Reset during render so returning to an earlier filter cannot resurrect its old page.
    setPager({ filterKey, cursors: [null] });
  }
  const cursors = pager.filterKey === filterKey ? pager.cursors : [null];
  const cursor = cursors.at(-1) ?? null;
  const pageNumber = cursors.length;

  const list = useQuery(
    trpc.github.list.queryOptions(
      { keyword, sort, cursor, limit: PAGE_SIZE },
      { placeholderData: keepPreviousData, meta: { silent: true } }
    )
  );

  const goNext = () => {
    const next = list.data?.nextCursor;
    if (next) {
      setPager({ filterKey, cursors: [...cursors, next] });
    }
  };
  const goPrevious = () => {
    if (cursors.length > 1) {
      setPager({ filterKey, cursors: cursors.slice(0, -1) });
    }
  };

  const items = list.data?.items ?? [];
  // Deleting the last row of a later page would leave an empty page; step back.
  const handleDeleted = () => {
    if (items.length === 1) {
      goPrevious();
    }
  };

  return (
    <section aria-labelledby={`${keywordId}-title`} className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-medium text-base" id={`${keywordId}-title`}>
          系统人员
          {list.data ? <span className="ml-2 text-muted-foreground text-sm">共 {list.data.total} 人</span> : null}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={keywordId}>过滤</Label>
            <Input
              className="w-56"
              id={keywordId}
              onChange={(event) => setKeywordInput(event.target.value)}
              placeholder="用户名 / 昵称 / 备注"
              type="search"
              value={keywordInput}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={sortId}>排序</Label>
            <select
              className="h-8 border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 dark:bg-input/30"
              id={sortId}
              onChange={(event) => setSort(event.target.value as GithubSort)}
              value={sort}
            >
              {GITHUB_SORTS.map((value) => (
                <option key={value} value={value}>
                  {GITHUB_SORT_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <ListBody hasKeyword={keyword !== ""} items={items} list={list} onDeleted={handleDeleted} />

      {list.data && list.data.total > 0 ? (
        <nav aria-label="分页" className="flex items-center justify-end gap-2">
          <span className="text-muted-foreground text-xs">第 {pageNumber} 页</span>
          <Button disabled={pageNumber <= 1} onClick={goPrevious} size="sm" variant="outline">
            <ChevronLeftIcon aria-hidden="true" />
            上一页
          </Button>
          <Button disabled={!list.data.nextCursor || list.isPlaceholderData} onClick={goNext} size="sm" variant="outline">
            下一页
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </nav>
      ) : null}
    </section>
  );
}

type ListState = {
  isPending: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: () => unknown;
};

function ListBody({
  list,
  items,
  hasKeyword,
  onDeleted,
}: {
  list: ListState;
  items: GithubProfile[];
  hasKeyword: boolean;
  onDeleted: () => void;
}) {
  if (list.isPending) {
    return (
      <div aria-label="正在加载" className="grid gap-2" role="status">
        {SKELETON_ROWS.map((key) => (
          <Skeleton className="h-14 w-full" key={key} />
        ))}
      </div>
    );
  }
  if (list.isError && items.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>加载失败</EmptyTitle>
          <EmptyDescription>无法获取人员列表，请检查网络后重试。</EmptyDescription>
        </EmptyHeader>
        <Button disabled={list.isRefetching} onClick={() => list.refetch()} variant="outline">
          重试
        </Button>
      </Empty>
    );
  }
  if (items.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{hasKeyword ? "没有匹配的人员" : "暂无人员"}</EmptyTitle>
          <EmptyDescription>
            {hasKeyword ? "换个关键字试试。" : "还没有添加任何 GitHub 用户，先在上方搜索一个吧"}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>人员</TableHead>
              <TableHead>备注</TableHead>
              <TableHead>标签</TableHead>
              <TableHead className="text-right">粉丝</TableHead>
              <TableHead className="text-right">仓库</TableHead>
              <TableHead>最后同步</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((profile) => (
              <TableRow data-login={profile.login} key={profile.id}>
                <TableCell>
                  <PersonCell profile={profile} />
                </TableCell>
                <TableCell className="max-w-48 truncate" title={profile.note ?? undefined}>
                  {profile.note ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  <Tags tags={profile.tags} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCount(profile.followers)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCount(profile.publicRepos)}</TableCell>
                <TableCell>
                  <time dateTime={profile.syncedAt}>{formatRelativeTime(profile.syncedAt)}</time>
                </TableCell>
                <TableCell className="text-right">
                  <GithubRowActions onDeleted={onDeleted} profile={profile} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid gap-3 md:hidden">
        {items.map((profile) => (
          <li className="grid gap-2 border p-3" data-login={profile.login} key={profile.id}>
            <PersonCell profile={profile} />
            {profile.note ? <p className="break-words text-sm">{profile.note}</p> : null}
            <Tags tags={profile.tags} />
            <p className="text-muted-foreground text-xs">
              粉丝 <span className="tabular-nums">{formatCount(profile.followers)}</span> · 仓库{" "}
              <span className="tabular-nums">{formatCount(profile.publicRepos)}</span> · 同步于{" "}
              <time dateTime={profile.syncedAt}>{formatRelativeTime(profile.syncedAt)}</time>
            </p>
            <GithubRowActions onDeleted={onDeleted} profile={profile} />
          </li>
        ))}
      </ul>
    </>
  );
}

function PersonCell({ profile }: { profile: GithubProfile }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <GithubAvatar login={profile.login} size={36} src={profile.avatarUrl} />
      <div className="min-w-0">
        <p className="truncate font-medium">{profile.name ?? profile.login}</p>
        <a
          className="text-muted-foreground text-xs underline-offset-4 hover:underline"
          href={profile.htmlUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          @{profile.login}
        </a>
      </div>
    </div>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="outline">
          {tag}
        </Badge>
      ))}
    </div>
  );
}
