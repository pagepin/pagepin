import { useEffect, useState } from 'react';
import { Loader2, Search, Terminal } from 'lucide-react';
import { useStore } from '../store';
import { SiteCard } from './SiteCard';

export function SiteList() {
  const sites = useStore((s) => s.sites);
  const loading = useStore((s) => s.loadingSites);

  // 公开倒计时用的时钟，30s 一跳
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const [query, setQuery] = useState('');
  // 展开集合：null = 首次加载未初始化（站点 ≤3 个时自动全展开，多了默认全折叠）
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (expanded === null && sites.length > 0) {
      setExpanded(new Set(sites.length <= 3 ? sites.map((s) => s.slug) : []));
    }
  }, [sites, expanded]);

  const toggle = (slug: string) =>
    setExpanded((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sites.filter(
        (s) => s.slug.toLowerCase().includes(q) || (s.title ?? '').toLowerCase().includes(q),
      )
    : sites;

  // 零站点:不再摞第二个 hero 卡片(与上方 DropZone 冗余),只留一条纤细的 curl 提示,
  // 让首屏不溢出常见笔记本视口(详见提交说明)。隐藏空的 "Your sites" 标题与搜索。
  if (sites.length === 0 && !loading) {
    return (
      <section className="mt-6 animate-fade-up rounded-card border border-dashed border-ink-200 bg-white/50 px-6 py-7 text-center">
        <p className="text-[13.5px] font-semibold text-ink-600">No sites yet</p>
        <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-ink-400">
          Drop a file above, or deploy straight from your terminal:
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-field bg-ink-900 px-3.5 py-2 font-mono text-xs text-ink-200">
          <Terminal className="h-3.5 w-3.5 text-tide-300" />
          curl -X POST …/api/sites/my-report/deploy
        </div>
      </section>
    );
  }

  return (
    <section className="mt-10 animate-fade-up">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex shrink-0 items-baseline gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-ink-500">
            Your sites
          </span>
          {sites.length > 0 && <span className="font-mono text-xs text-ink-400">{sites.length}</span>}
        </h2>
        <div className="flex items-center gap-2">
          {sites.length > 5 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
              <input
                data-testid="site-list-search"
                className="input !w-44 !py-1.5 !pl-8 !text-xs sm:!w-56"
                placeholder="Search slug or title"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-ink-400" />}
        </div>
      </div>

      {filtered.length === 0 && q ? (
        <div className="rounded-card border border-dashed border-ink-200 bg-white/60 px-6 py-10 text-center text-[13px] text-ink-400">
          No sites match &ldquo;{query.trim()}&rdquo;
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((site) => (
            <SiteCard
              key={site.slug}
              site={site}
              now={now}
              expanded={(expanded ?? new Set()).has(site.slug)}
              onToggle={() => toggle(site.slug)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
