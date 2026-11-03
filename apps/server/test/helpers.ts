import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createPrismaClient } from "@my-better-t-app/db";

const SERVER_PORT = 3000;
const SERVER_START_TIMEOUT_MS = 30_000;
const SERVER_READY_PATTERN = /Server is running/;

export const BASE_URL = `http://localhost:${SERVER_PORT}`;

const serverDir = fileURLToPath(new URL("..", import.meta.url));

export function getDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set; run tests through `pnpm test`.");
  }
  return createPrismaClient({ DATABASE_URL: url });
}

export function startServer(): Promise<ChildProcess> {
  const child = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: serverDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Server did not start in time"));
    }, SERVER_START_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (SERVER_READY_PATTERN.test(chunk.toString())) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code}`));
    });
  });
}

export function stopServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

export function uniqueUsername(prefix = "t"): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

/** A fresh client IP, so each test gets its own rate-limit bucket. */
export function randomClientIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

type RequestOptions = {
  body?: unknown;
  cookie?: string;
  ip?: string;
  method?: "GET" | "POST";
};

export async function request(path: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3001",
    "x-forwarded-for": options.ip ?? randomClientIp(),
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  const json: unknown = isJson && text ? JSON.parse(text) : null;
  return { response, json };
}

export function getSessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

export function signUp(username: string, password: string, ip?: string) {
  return request("/api/auth/sign-up/email", {
    body: { email: "", name: username, username, password },
    ip,
  });
}
