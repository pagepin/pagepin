export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Relative time, e.g. "3m ago" / "2d ago"; falls back to a date after 14 days. */
export function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return 'just now';
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 14 * day) return `${Math.floor(diff / day)}d ago`;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Remaining public window, e.g. "2d 3h left" / "45m left". Returns null once expired. */
export function formatRemaining(expiresIso: string, now: number): string | null {
  const t = new Date(expiresIso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = t - now;
  if (diff <= 0) return null;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff >= day) {
    const d = Math.floor(diff / day);
    const h = Math.floor((diff % day) / hour);
    return h > 0 ? `${d}d ${h}h left` : `${d}d left`;
  }
  if (diff >= hour) {
    const h = Math.floor(diff / hour);
    const m = Math.floor((diff % hour) / min);
    return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
  }
  return `${Math.max(1, Math.floor(diff / min))}m left`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
