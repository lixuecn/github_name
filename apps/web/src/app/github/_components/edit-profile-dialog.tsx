"use client";

import {
  NOTE_MAX_LENGTH,
  noteSchema,
  TAG_MAX_LENGTH,
  TAGS_MAX_COUNT,
  tagsSchema,
} from "@my-better-t-app/api/shared/github";
import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@my-better-t-app/ui/components/dialog";
import { Input } from "@my-better-t-app/ui/components/input";
import { Label } from "@my-better-t-app/ui/components/label";
import { Textarea } from "@my-better-t-app/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";
import { toast } from "sonner";

import { getErrorCode, getErrorMessage } from "@/lib/trpc-error";
import { useTRPC } from "@/utils/trpc";

import type { GithubProfile } from "./types";

type Props = {
  profile: GithubProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditProfileDialog({ profile, open, onOpenChange }: Props) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑 {profile.login}</DialogTitle>
          <DialogDescription>修改备注与标签，不会影响 GitHub 资料。</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each opening starts from saved values. */}
        {open ? <EditProfileForm onDone={() => onOpenChange(false)} profile={profile} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditProfileForm({ profile, onDone }: { profile: GithubProfile; onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const noteId = useId();
  const tagId = useId();
  const [note, setNote] = useState(profile.note ?? "");
  const [tags, setTags] = useState<string[]>(profile.tags);
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const update = useMutation(
    trpc.github.update.mutationOptions({
      onSuccess: async () => {
        toast.success("保存成功");
        onDone();
        await queryClient.invalidateQueries(trpc.github.list.pathFilter());
      },
      onError: async (mutationError) => {
        if (getErrorCode(mutationError) === "NOT_FOUND") {
          toast.error(mutationError.message);
          onDone();
          await queryClient.invalidateQueries(trpc.github.list.pathFilter());
          return;
        }
        setError(getErrorMessage(mutationError));
      },
    })
  );

  const addTag = () => {
    const value = tagInput.trim();
    if (value === "") {
      return;
    }
    if (tags.includes(value)) {
      setTagInput("");
      return;
    }
    const parsed = tagsSchema.safeParse([...tags, value]);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "标签不合法");
      return;
    }
    setError(null);
    setTags(parsed.data);
    setTagInput("");
  };

  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      addTag();
    }
  };

  const handleSave = () => {
    const parsedNote = noteSchema.safeParse(note);
    const parsedTags = tagsSchema.safeParse(tags);
    if (!parsedNote.success) {
      setError(parsedNote.error.issues[0]?.message ?? "备注不合法");
      return;
    }
    if (!parsedTags.success) {
      setError(parsedTags.error.issues[0]?.message ?? "标签不合法");
      return;
    }
    setError(null);
    update.mutate({ id: profile.id, note: parsedNote.data, tags: parsedTags.data });
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        handleSave();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={noteId}>备注</Label>
        <Textarea
          id={noteId}
          maxLength={NOTE_MAX_LENGTH}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          value={note}
        />
        <span className="text-muted-foreground text-xs">还可输入 {NOTE_MAX_LENGTH - note.length} 字</span>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={tagId}>标签</Label>
        {tags.length > 0 ? (
          <ul aria-label="已添加的标签" className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <li key={tag}>
                <Badge className="pr-0.5" variant="secondary">
                  {tag}
                  <button
                    aria-label={`移除标签 ${tag}`}
                    className="inline-flex size-4 items-center justify-center hover:text-destructive"
                    onClick={() => setTags(tags.filter((item) => item !== tag))}
                    type="button"
                  >
                    <XIcon aria-hidden="true" className="size-3" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        <Input
          disabled={tags.length >= TAGS_MAX_COUNT}
          id={tagId}
          maxLength={TAG_MAX_LENGTH + 1}
          onChange={(event) => setTagInput(event.target.value)}
          onKeyDown={handleTagKeyDown}
          placeholder={tags.length >= TAGS_MAX_COUNT ? `最多 ${TAGS_MAX_COUNT} 个标签` : "输入后按回车或逗号添加"}
          value={tagInput}
        />
        <span className="text-muted-foreground text-xs">
          最多 {TAGS_MAX_COUNT} 个，每个不超过 {TAG_MAX_LENGTH} 字
        </span>
      </div>

      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button onClick={onDone} type="button" variant="outline">
          取消
        </Button>
        <Button disabled={update.isPending} type="submit">
          {update.isPending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </form>
  );
}
