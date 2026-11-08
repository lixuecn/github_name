"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@my-better-t-app/ui/components/alert-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getErrorCode, getErrorMessage } from "@/lib/trpc-error";
import { useTRPC } from "@/utils/trpc";

import type { GithubProfile } from "./types";

type Props = {
  profile: GithubProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
};

export function DeleteProfileDialog({ profile, open, onOpenChange, onDeleted }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const remove = useMutation(
    trpc.github.delete.mutationOptions({
      onSuccess: async () => {
        toast.success("已删除");
        onOpenChange(false);
        onDeleted();
        // The search card's "已添加" state depends on membership too.
        await Promise.all([
          queryClient.invalidateQueries(trpc.github.list.pathFilter()),
          queryClient.invalidateQueries(trpc.github.search.pathFilter()),
        ]);
      },
      onError: async (error) => {
        toast.error(getErrorMessage(error));
        if (getErrorCode(error) === "NOT_FOUND") {
          onOpenChange(false);
          await queryClient.invalidateQueries(trpc.github.list.pathFilter());
        }
      },
    })
  );

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除人员</AlertDialogTitle>
          <AlertDialogDescription>确定将 {profile.login} 从系统中移除吗？</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: profile.id })}
            variant="destructive"
          >
            {remove.isPending ? "删除中…" : "确认删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
