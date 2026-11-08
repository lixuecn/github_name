type ErrorLike = { message: string; data?: { code?: string } | null };

/** Codes whose server messages are written for end users. */
const USER_FACING_CODES = new Set([
  "BAD_REQUEST",
  "NOT_FOUND",
  "CONFLICT",
  "TOO_MANY_REQUESTS",
  "BAD_GATEWAY",
]);

export function getErrorMessage(error: ErrorLike | null | undefined, fallback = "操作失败，请稍后重试"): string {
  const code = error?.data?.code;
  if (error && code && USER_FACING_CODES.has(code)) {
    return error.message;
  }
  return fallback;
}

export const getErrorCode = (error: ErrorLike | null | undefined) => error?.data?.code;
