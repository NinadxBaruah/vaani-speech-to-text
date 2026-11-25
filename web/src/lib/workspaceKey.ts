const STORAGE_KEY = 'vaani.workspaceKey';
export const KEY_PATTERN = /^stt_[A-Za-z0-9_-]{43}$/;

export function loadKey(): string | null {
  try {
    const key = localStorage.getItem(STORAGE_KEY);
    return key && KEY_PATTERN.test(key) ? key : null;
  } catch {
    return null; // storage disabled (private mode etc.)
  }
}

export function saveKey(key: string) {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* the key still works for this tab */
  }
}

export function maskKey(key: string): string {
  return `${key.slice(0, 10)}${'•'.repeat(8)}${key.slice(-4)}`;
}
