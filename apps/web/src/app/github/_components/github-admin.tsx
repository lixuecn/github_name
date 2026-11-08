"use client";

import { GithubList } from "./github-list";
import { GithubSearch } from "./github-search";

export function GithubAdmin() {
  return (
    <main className="container mx-auto grid max-w-5xl gap-8 px-4 py-6">
      <header>
        <h1 className="font-semibold text-xl">GitHub 人员</h1>
        <p className="text-muted-foreground text-sm">搜索 GitHub 用户并加入系统，管理已加入的人员。</p>
      </header>
      <GithubSearch />
      <GithubList />
    </main>
  );
}
