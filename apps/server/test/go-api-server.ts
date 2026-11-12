import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Builds and runs the real Go service (separate go-api repository) for tests.
// Point GO_API_DIR at a checkout; the default is a `go-api` directory next to
// this repository.

const GO_API_DIR =
  process.env.GO_API_DIR ?? fileURLToPath(new URL("../../../../go-api", import.meta.url));
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 100;

function goAvailable(): boolean {
  try {
    execFileSync("go", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Why Go-backed tests cannot run here, or false when they can. */
export function goApiSkipReason(): string | false {
  if (!existsSync(join(GO_API_DIR, "go.mod"))) {
    return `go-api checkout not found at ${GO_API_DIR} (set GO_API_DIR)`;
  }
  return goAvailable() ? false : "Go toolchain not installed";
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))
      );
    });
  });
}

async function waitForReady(baseUrl: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/ready`)).ok) {
        return;
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(`go-api did not become ready at ${baseUrl}`);
}

export type RunningGoApi = { baseUrl: string; stop: () => void };

/** Builds go-api and starts it against `databaseUrl`; resolves once /ready is OK. */
export async function startGoApi(databaseUrl: string): Promise<RunningGoApi> {
  const buildDir = mkdtempSync(join(tmpdir(), "go-api-test-"));
  const binary = join(buildDir, "go-api");
  execFileSync("go", ["build", "-o", binary, "./cmd/server"], {
    cwd: GO_API_DIR,
    env: { ...process.env, CGO_ENABLED: "0" },
    stdio: "inherit",
  });

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(binary, [], {
    env: { PATH: process.env.PATH, PORT: String(port), DATABASE_URL: databaseUrl },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const stop = () => {
    child.kill("SIGTERM");
    rmSync(buildDir, { recursive: true, force: true });
  };
  try {
    await waitForReady(baseUrl);
  } catch (error) {
    stop();
    throw error;
  }
  return { baseUrl, stop };
}
