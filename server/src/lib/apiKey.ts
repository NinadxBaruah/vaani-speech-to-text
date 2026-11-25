import { createHash, randomBytes } from 'node:crypto';

const KEY_PREFIX = 'stt_';
// stt_ + 43 base64url chars (32 random bytes).
const KEY_PATTERN = /^stt_[A-Za-z0-9_-]{43}$/;

export function generateWorkspaceKey(): string {
  return KEY_PREFIX + randomBytes(32).toString('base64url');
}

export function isWellFormedKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** The DB only ever sees this hash. 256 bits of entropy makes a plain SHA-256 safe here. */
export function hashWorkspaceKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Short, non-secret label for the UI, e.g. "stt_Ab3xK9". */
export function keyDisplayPrefix(key: string): string {
  return key.slice(0, 10);
}

/** Extracts the key from an `Authorization: Bearer <key>` header. */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
