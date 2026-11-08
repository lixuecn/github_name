"use client";

import { Button } from "@my-better-t-app/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { getErrorMessage } from "@/lib/trpc-error";
import { useTRPC } from "@/utils/trpc";

import { DeleteProfileDialog } from "./delete-profile-dialog";
import { EditProfileDialog } from "./edit-profile-dialog";
import type { GithubProfile } from "./types";

export function GithubRowActions({ profile, onDeleted }: { profile: GithubProfile; onDeleted: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refreshList = () => queryClient.invalidateQueries(trpc.github.list.pathFilter());

  const sync = useMutation(
    trpc.github.sync.mutationOptions({
      onSuccess: async () => {
        toast.success("已同步");
        await refreshList();
      },
      onError: async (error) => {
        toast.error(getErrorMessage(error));
        await refreshList();
      },
    })
  );

  return (
    <div className="flex justify-end gap-1">
      <Button aria-label={`编辑 ${profile.login}`} onClick={() => setEditing(true)} size="icon-sm" variant="ghost">
        <PencilIcon aria-hidden="true" />
      </Button>
      <Button
        aria-label={`从 GitHub 刷新 ${profile.login}`}
        disabled={sync.isPending}
        onClick={() => sync.mutate({ id: profile.id })}
        size="icon-sm"
        variant="ghost"
      >
        <RefreshCwIcon aria-hidden="true" className={sync.isPending ? "animate-spin" : undefined} />
      </Button>
      <Button aria-label={`删除 ${profile.login}`} onClick={() => setDeleting(true)} size="icon-sm" variant="ghost">
        <Trash2Icon aria-hidden="true" />
      </Button>

      <EditProfileDialog onOpenChange={setEditing} open={editing} profile={profile} />
      <DeleteProfileDialog onDeleted={onDeleted} onOpenChange={setDeleting} open={deleting} profile={profile} />
    </div>
  );
}
