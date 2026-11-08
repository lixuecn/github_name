const THOUSAND = 1000;
const MILLION = 1_000_000;
const TRAILING_ZERO = /\.0$/;
const HAS_HTTP_SCHEME = /^https?:\/\//i;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const relativeFormatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

function compact(value: number, unit: number, suffix: string): string {
  return `${(value / unit).toFixed(1).replace(TRAILING_ZERO, "")}${suffix}`;
}

/** 999 → "999", 1234 → "1.2k", 3_400_000 → "3.4M". */
export function formatCount(value: number): string {
  if (value < THOUSAND) {
    return String(value);
  }
  // 999_950 would round to "1000.0k"; switch to millions instead.
  if (value < MILLION && Math.round(value / 100) < MILLION / 100) {
    return compact(value, THOUSAND, "k");
  }
  return compact(value, MILLION, "M");
}

/** "刚刚" under a minute, otherwise "3 分钟前" / "2 天前" / "1 年前". */
export function formatRelativeTime(value: string | Date, now: number = Date.now()): string {
  const diff = new Date(value).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < MINUTE) {
    return "刚刚";
  }
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [YEAR, "year"],
    [MONTH, "month"],
    [DAY, "day"],
    [HOUR, "hour"],
    [MINUTE, "minute"],
  ];
  for (const [size, unit] of steps) {
    if (abs >= size) {
      return relativeFormatter.format(Math.round(diff / size), unit);
    }
  }
  return "刚刚";
}

/** YYYY-MM-DD in local time. */
export function formatDate(value: string | Date): string {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Returns a normalised http(s) URL, or null when the value is not one. */
export function toSafeHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const candidate = HAS_HTTP_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
