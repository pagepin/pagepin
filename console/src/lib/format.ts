export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 相对时间，如「3 分钟前」「2 天前」，超过 14 天显示日期。 */
export function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 14 * day) return `${Math.floor(diff / day)} 天前`;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 公开剩余时间，如「剩 2 天 3 小时」「剩 45 分钟」。已过期返回 null。 */
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
    return h > 0 ? `剩 ${d} 天 ${h} 小时` : `剩 ${d} 天`;
  }
  if (diff >= hour) {
    const h = Math.floor(diff / hour);
    const m = Math.floor((diff % hour) / min);
    return m > 0 ? `剩 ${h} 小时 ${m} 分` : `剩 ${h} 小时`;
  }
  return `剩 ${Math.max(1, Math.floor(diff / min))} 分钟`;
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
