import { cn } from "@my-better-t-app/ui/lib/utils";
import Image from "next/image";

export function GithubAvatar({ src, login, size, className }: { src: string; login: string; size: number; className?: string }) {
  return (
    <Image
      alt={`${login} 的头像`}
      className={cn("shrink-0 rounded-full bg-muted", className)}
      height={size}
      src={src}
      unoptimized
      width={size}
    />
  );
}
