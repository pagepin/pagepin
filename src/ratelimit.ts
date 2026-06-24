/** 轻量限流 —— edge-safe 接口 + 进程内固定窗口实现。
 *
 * 注入式（AppDeps.rateLimiter），与 Storage/db 一样由两个 entry 各自提供实现；缺省=不限流。
 * Node 单进程下内存计数即有效；Workers 上是 per-isolate 尽力而为（跨 colo/isolate 不共享，
 * isolate 回收即重置）。把它当「应用层多一道防线」即可——真正的边缘防护请用 Cloudflare
 * Rate Limiting Rules（零应用代码、全局生效）。
 */

export interface RateLimiter {
  /** windowSec 窗口内 key 的命中数是否仍未超 limit。true=放行（并计数），false=超限。 */
  check(key: string, limit: number, windowSec: number): Promise<boolean>;
}

interface Bucket {
  count: number;
  resetAt: number; // epoch ms
}

/** 进程内固定窗口计数器。Node 单进程有效；Workers per-isolate 尽力而为。 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  check(key: string, limit: number, windowSec: number): Promise<boolean> {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
      this.sweep(now);
      return Promise.resolve(true);
    }
    if (b.count >= limit) return Promise.resolve(false);
    b.count += 1;
    return Promise.resolve(true);
  }

  /** 顺手清掉过期桶，避免长寿进程内存无界增长（仅在桶数偏多时跑一次）。 */
  private sweep(now: number): void {
    if (this.buckets.size < 1000) return;
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
  }
}
