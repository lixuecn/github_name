const THOUSAND = 1000;
const MILLION = 1_000_000;
const TRAILING_ZERO = /\.0$/;

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
