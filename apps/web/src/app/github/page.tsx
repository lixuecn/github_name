import type { Metadata } from "next";

import { GithubAdmin } from "./_components/github-admin";

export const metadata: Metadata = {
  title: "GitHub 人员",
  description: "搜索 GitHub 用户并管理系统中的人员",
};

export default function GithubPage() {
  return <GithubAdmin />;
}
