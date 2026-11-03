export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

// Better Auth requires an email on every user; username-only accounts get an
// undeliverable address on the reserved `.invalid` TLD (RFC 2606).
const PLACEHOLDER_EMAIL_DOMAIN = "users.invalid";

export function isValidUsername(username: string): boolean {
  return (
    username.length >= USERNAME_MIN_LENGTH &&
    username.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(username)
  );
}

export function toPlaceholderEmail(username: string): string {
  return `${username.toLowerCase()}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}
