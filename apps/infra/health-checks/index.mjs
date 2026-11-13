// Scheduled health checks (a lightweight stand-in for CloudWatch Synthetics,
// which this account cannot run: Lambda memory is capped at 512 MB and
// Synthetics needs ~1 GB for its browser).
//
// One handler, two checks selected by the CHECK environment variable:
//   CHECK=api  API Gateway -> backend Lambda -> go-api -> RDS
//   CHECK=web  the Cloudflare-hosted page renders and may call the API (CORS)
//
// Every step logs one JSON line. Any failure throws, which the Lambda Errors
// alarm (github-name-api-check / github-name-web-check) turns into ALARM.

const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "github-name-health-check/1.0";

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(JSON.stringify({ step: name, ok: true, ms: Date.now() - started, ...detail }));
  } catch (error) {
    console.log(JSON.stringify({ step: name, ok: false, ms: Date.now() - started, error: String(error) }));
    throw new Error(`health check step "${name}" failed: ${error instanceof Error ? error.message : error}`);
  }
}

async function get(url, init = {}) {
  return await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function getJson(url) {
  const response = await get(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return { status: response.status, json: await response.json() };
}

export async function checkApi(apiBaseUrl) {
  const base = apiBaseUrl.replace(/\/+$/, "");

  // Lambda and tRPC are up.
  await step("healthCheck", async () => {
    const { status, json } = await getJson(`${base}/trpc/healthCheck`);
    if (json?.result?.data !== "OK") {
      throw new Error(`unexpected body ${JSON.stringify(json).slice(0, 200)}`);
    }
    return { status };
  });

  // Full read path through the Go service to the database.
  await step("listProfiles", async () => {
    const input = encodeURIComponent(JSON.stringify({ limit: 1 }));
    const { status, json } = await getJson(`${base}/trpc/github.list?input=${input}`);
    const data = json?.result?.data;
    if (!(data && Array.isArray(data.items) && Number.isInteger(data.total))) {
      throw new Error(`unexpected body ${JSON.stringify(json).slice(0, 200)}`);
    }
    return { status, total: data.total };
  });
}

export async function checkWeb(webUrl, apiBaseUrl, expectedTitle) {
  const origin = new URL(webUrl).origin;

  // The page is served and server-rendered (title present).
  await step("openPeoplePage", async () => {
    const response = await get(webUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) {
      throw new Error(`content-type ${type}`);
    }
    const html = await response.text();
    if (!html.includes(`<title>${expectedTitle}</title>`)) {
      throw new Error(`title "${expectedTitle}" not found`);
    }
    return { status: response.status, bytes: html.length };
  });

  // The browser on this origin is allowed to call the API (CORS preflight).
  await step("apiAllowsWebOrigin", async () => {
    const response = await get(`${apiBaseUrl.replace(/\/+$/, "")}/trpc/github.list`, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
    });
    const allowed = response.headers.get("access-control-allow-origin");
    if (!response.ok || allowed !== origin) {
      throw new Error(`HTTP ${response.status}, access-control-allow-origin=${allowed}`);
    }
    return { status: response.status };
  });
}

export const handler = async () => {
  const { CHECK, API_BASE_URL, WEB_URL, WEB_TITLE } = process.env;
  if (CHECK === "api") {
    await checkApi(API_BASE_URL);
  } else if (CHECK === "web") {
    await checkWeb(WEB_URL, API_BASE_URL, WEB_TITLE);
  } else {
    throw new Error(`unknown CHECK "${CHECK}"`);
  }
  return { check: CHECK, ok: true };
};
