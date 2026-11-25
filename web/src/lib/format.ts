import type { Language } from './api';

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function formatDuration(ms: number | null | undefined): string | null {
  if (!ms || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}

export function languageName(code: string, languages: Language[] | undefined): string {
  if (code === 'auto') return 'Auto-detect';
  return languages?.find((l) => l.code === code)?.name ?? code;
}
