import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
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

  return (
    <section className="mt-10 animate-fade-up">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="shrink-0 text-sm font-semibold uppercase tracking-wider text-stone-400">
          我的站点{sites.length > 0 && ` · ${sites.length}`}
        </h2>
        <div className="flex items-center gap-2">
          {sites.length > 5 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-300" />
              <input
                className="input !w-44 !py-1.5 !pl-8 !text-xs sm:!w-56"
                placeholder="搜索 slug / 标题"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-stone-300" />}
        </div>
      </div>

      {sites.length === 0 && !loading ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/50 px-6 py-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-stone-100 text-3xl">
            🗂️
          </div>
          <p className="mt-4 text-sm font-medium text-stone-600">这里还空着</p>
          <p className="mt-1 text-xs text-stone-400">
            把一个文件夹拖进上面的虚线框，几秒钟后你就有第一个链接了
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white/50 px-6 py-10 text-center text-xs text-stone-400">
          没有匹配「{query.trim()}」的站点
        </div>
      ) : (
        <div className="space-y-2">
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
