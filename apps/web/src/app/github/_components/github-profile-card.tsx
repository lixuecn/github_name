"use client";

import { NOTE_MAX_LENGTH } from "@my-better-t-app/api/shared/github";
import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import { Label } from "@my-better-t-app/ui/components/label";
import { Textarea } from "@my-better-t-app/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BuildingIcon, CalendarIcon, ExternalLinkIcon, LinkIcon, MapPinIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";

import { formatCount, formatDate, toSafeHttpUrl } from "@/lib/format";
import { getErrorMessage } from "@/lib/trpc-error";
import { useTRPC } from "@/utils/trpc";

import { GithubAvatar } from "./avatar";
import type { GithubSearchResult } from "./types";

const EXTERNAL_LINK = { target: "_blank", rel: "noopener noreferrer" } as const;

export function GithubProfileCard({ profile }: { profile: GithubSearchResult }) {
  const blogUrl = toSafeHttpUrl(profile.blog);

  return (
    <article aria-label={`${profile.login} 的 GitHub 资料`} className="grid gap-4 border p-4 sm:grid-cols-[auto_1fr]">
      <GithubAvatar login={profile.login} size={80} src={profile.avatarUrl} />
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-lg">{profile.name ?? profile.login}</h3>
            <p className="text-muted-foreground text-sm">@{profile.login}</p>
          </div>
          {profile.existsInSystem ? <Badge variant="secondary">已添加</Badge> : null}
        </div>

        {profile.bio ? <p className="text-sm">{profile.bio}</p> : null}

        <ul className="grid gap-1 text-muted-foreground text-sm">
          {profile.company ? <InfoRow icon={<BuildingIcon />}>{profile.company}</InfoRow> : null}
          {profile.location ? <InfoRow icon={<MapPinIcon />}>{profile.location}</InfoRow> : null}
          {profile.blog ? (
            <InfoRow icon={<LinkIcon />}>
              {blogUrl ? (
                <a className="underline-offset-4 hover:underline" href={blogUrl} {...EXTERNAL_LINK}>
                  {profile.blog}
                </a>
              ) : (
                profile.blog
              )}
            </InfoRow>
          ) : null}
          {profile.twitterUsername ? (
            <InfoRow icon={<span aria-hidden="true">𝕏</span>}>
              <a
                className="underline-offset-4 hover:underline"
                href={`https://x.com/${encodeURIComponent(profile.twitterUsername)}`}
                {...EXTERNAL_LINK}
              >
                @{profile.twitterUsername}
              </a>
            </InfoRow>
          ) : null}
          <InfoRow icon={<CalendarIcon />}>{formatDate(profile.githubCreatedAt)} 加入 GitHub</InfoRow>
        </ul>

        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Stat label="公开仓库" value={profile.publicRepos} />
          <Stat label="粉丝" value={profile.followers} />
          <Stat label="关注" value={profile.following} />
        </dl>

        <a
          className="inline-flex w-fit items-center gap-1 text-primary text-sm underline-offset-4 hover:underline"
          href={profile.htmlUrl}
          {...EXTERNAL_LINK}
        >
          <ExternalLinkIcon aria-hidden="true" className="size-4" />在 GitHub 中打开
        </a>

        {profile.existsInSystem ? null : <AddToSystemForm username={profile.login} />}
      </div>
    </article>
  );
}

function InfoRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
      <span aria-hidden="true" className="flex w-4 justify-center">
        {icon}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1">
      <dd className="font-semibold tabular-nums">{formatCount(value)}</dd>
      <dt className="text-muted-foreground">{label}</dt>
    </div>
  );
}

function AddToSystemForm({ username }: { username: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [note, setNote] = useState("");

  const create = useMutation(
    trpc.github.create.mutationOptions({
      onSuccess: async () => {
        toast.success("添加成功");
        await Promise.all([
          queryClient.invalidateQueries(trpc.github.list.pathFilter()),
          queryClient.invalidateQueries(trpc.github.search.pathFilter()),
        ]);
      },
      onError: (error) => {
        toast.error(getErrorMessage(error));
      },
    })
  );

  const remaining = NOTE_MAX_LENGTH - note.length;

  return (
    <form
      className="grid gap-1.5 border-t pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({ username, note });
      }}
    >
      <Label htmlFor={noteId}>备注（可选）</Label>
      <Textarea
        aria-describedby={`${noteId}-count`}
        id={noteId}
        maxLength={NOTE_MAX_LENGTH}
        onChange={(event) => setNote(event.target.value)}
        placeholder="例如：核心贡献者"
        rows={2}
        value={note}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs" id={`${noteId}-count`}>
          还可输入 {remaining} 字
        </span>
        <Button disabled={create.isPending} type="submit">
          <PlusIcon aria-hidden="true" />
          {create.isPending ? "添加中…" : "加入系统"}
        </Button>
      </div>
    </form>
  );
}
