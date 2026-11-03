const HTTP_TOO_MANY_REQUESTS = 429;

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_USERNAME: "用户名只能包含字母、数字和下划线",
  INVALID_USERNAME_OR_PASSWORD: "用户名或密码错误",
  USER_ALREADY_EXISTS: "该用户名已被注册",
  USERNAME_IS_ALREADY_TAKEN: "该用户名已被注册",
  USERNAME_TOO_LONG: "用户名不能超过 20 个字符",
  USERNAME_TOO_SHORT: "用户名至少 3 个字符",
};

type AuthError = {
  code?: string;
  status?: number;
};

export function getAuthErrorMessage(error: AuthError, fallback: string): string {
  if (error.status === HTTP_TOO_MANY_REQUESTS) {
    return "请求过于频繁，请稍后再试";
  }
  return (error.code && AUTH_ERROR_MESSAGES[error.code]) || fallback;
}
