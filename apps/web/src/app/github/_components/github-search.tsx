"use client";

import { githubUsernameSchema } from "@my-better-t-app/api/shared/github";
import { Button } from "@my-better-t-app/ui/components/button";
import { Input } from "@my-better-t-app/ui/components/input";
import { Label } from "@my-better-t-app/ui/components/label";
import { Skeleton } from "@my-better-t-app/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { type FormEvent, useId, useState } from "react";

import { getErrorCode } from "@/lib/trpc-error";
import { useTRPC } from "@/utils/trpc";

import { GithubProfileCard } from "./github-profile-card";

const SEARCH_ERROR_CODES = new Set(["NOT_FOUND", "TOO_MANY_REQUESTS", "BAD_REQUEST"]);

export function GithubSearch() {
  const trpc = useTRPC();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const search = useQuery(
    trpc.github.search.queryOptions(
      { username: username ?? "" },
      { enabled: username !== null, retry: false, meta: { silent: true } }
    )
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value.trim() === "") {
      setFieldError(null);
      return;
    }
    const parsed = githubUsernameSchema.safeParse(value);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "GitHub 用户名格式不正确");
      return;
    }
    setFieldError(null);
    if (parsed.data === username) {
      // Same query key: re-submitting must still hit the server (e.g. after a failure).
      search.refetch();
      return;
    }
    setUsername(parsed.data);
  };

  const isSearching = username !== null && search.isFetching;
  // Background refetches keep the current card (and any drafted note) mounted.
  const showSkeleton = isSearching && !search.data;
  const errorCode = getErrorCode(search.error);
  const searchError =
    search.error && errorCode && SEARCH_ERROR_CODES.has(errorCode) ? search.error.message : "查询失败，请稍后重试";

  return (
    <section aria-labelledby={`${inputId}-title`} className="grid gap-4">
      <h2 className="font-medium text-base" id={`${inputId}-title`}>
        搜索 GitHub 用户
      </h2>
      <form className="grid gap-1.5" noValidate onSubmit={handleSubmit}>
        <Label htmlFor={inputId}>GitHub 用户名</Label>
        <div className="flex gap-2">
          <Input
            aria-describedby={fieldError ? errorId : undefined}
            aria-invalid={fieldError ? true : undefined}
            autoComplete="off"
            className="max-w-sm"
            id={inputId}
            name="username"
            onChange={(event) => setValue(event.target.value)}
            placeholder="例如 torvalds"
            value={value}
          />
          <Button disabled={isSearching} type="submit">
            <SearchIcon aria-hidden="true" />
            搜索
          </Button>
        </div>
        {fieldError ? (
          <p className="text-destructive text-xs" id={errorId} role="alert">
            {fieldError}
          </p>
        ) : null}
      </form>

      <div aria-live="polite">
        {showSkeleton ? <SearchSkeleton /> : null}
        {!isSearching && search.isError ? (
          <p className="border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm" role="alert">
            {searchError}
          </p>
        ) : null}
        {search.data && !(search.isError && !isSearching) ? (
          <GithubProfileCard key={search.data.githubId} profile={search.data} />
        ) : null}
      </div>
    </section>
  );
}

function SearchSkeleton() {
  return (
    <div aria-label="正在查询" className="flex gap-4 border p-4" role="status">
      <Skeleton className="size-20 rounded-full" />
      <div className="grid flex-1 gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
    </div>
  );
}
