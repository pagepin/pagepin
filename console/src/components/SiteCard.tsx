import { useState } from 'react';
import {
  ChevronRight,
  Copy,
  ExternalLink,
  Globe2,
  History,
  Loader2,
  Lock,
  MessageSquare,
  Settings2,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { api } from '../api';
import { confirmDanger } from './ConfirmDialog';
import { copyText, formatBytes, formatRelative, formatRemaining } from '../lib/format';
import { useStore } from '../store';
import type { SiteOut, VersionsOut } from '../types';
import { toast, toastError } from './Toast';

const SHARE_OPTIONS: { label: string; hours: number }[] = [
  { label: '1 小时', hours: 1 },
  { label: '6 小时', hours: 6 },
  { label: '24 小时', hours: 24 },
  { label: '3 天', hours: 72 },
  { label: '7 天', hours: 168 },
];

type Panel = 'share' | 'settings' | 'versions' | null;

export function SiteCard({
  site,
  now,
  expanded,
  onToggle,
}: {
  site: SiteOut;
  now: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const me = useStore((s) => s.me);
  const upsertSite = useStore((s) => s.upsertSite);
  const removeSite = useStore((s) => s.removeSite);
  const setDeployTarget = useStore((s) => s.setDeployTarget);

  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<VersionsOut | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const remaining =
    site.visibility === 'public' && site.public_expires_at
      ? formatRemaining(site.public_expires_at, now)
      : null;
  const isPublicLive = site.visibility === 'public' && remaining !== null;
  const isExpired = site.visibility === 'public' && remaining === null;

  const shareOptions = me
    ? SHARE_OPTIONS.filter((o) => o.hours <= me.limits.public_max_hours)
    : SHARE_OPTIONS;

  function togglePanel(p: Panel) {
    setPanel((cur) => (cur === p ? null : p));
    if (p === 'versions' && panel !== 'versions') {
      setVersionsLoading(true);
      void api
        .versions(site.slug)
        .then(setVersions)
        .catch((e) => toastError(e, '加载版本失败'))
        .finally(() => setVersionsLoading(false));
    }
  }

  async function run<T>(fn: () => Promise<T>, onOk: (r: T) => void) {
    if (busy) return;
    setBusy(true);
    try {
      onOk(await fn());
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  function makePublic(hours: number) {
    void run(
      () => api.patchSite(site.slug, { visibility: 'public', public_hours: hours }),
      (updated) => {
        upsertSite(updated);
        setPanel(null);
        toast(`已公开，${SHARE_OPTIONS.find((o) => o.hours === hours)?.label ?? hours + ' 小时'}后自动转私有`);
      },
    );
  }

  function makePrivate() {
    void run(
      () => api.patchSite(site.slug, { visibility: 'private' }),
      (updated) => {
        upsertSite(updated);
        setPanel(null);
        toast('已转为私有');
      },
    );
  }

  function toggleSpa(next: boolean) {
    void run(
      () => api.patchSite(site.slug, { spa_fallback: next }),
      (updated) => {
        upsertSite(updated);
        toast(next ? '已开启 SPA fallback' : '已关闭 SPA fallback');
      },
    );
  }

  function toggleComments(next: boolean) {
    void run(
      () => api.patchSite(site.slug, { comments_enabled: next }),
      (updated) => {
        upsertSite(updated);
        toast(next ? '已开启页面评论' : '已关闭页面评论');
      },
    );
  }

  function rollback(versionId: string) {
    void run(
      () => api.rollback(site.slug, versionId),
      (updated) => {
        upsertSite(updated);
        setPanel(null);
        toast('已回滚到所选版本');
      },
    );
  }

  async function remove() {
    const ok = await confirmDanger({
      title: `删除站点「${site.slug}」？`,
      body: '站点与全部历史版本将一并删除，链接立即失效，此操作不可恢复。',
      confirmText: '删除站点',
    });
    if (!ok) return;
    void run(
      () => api.deleteSite(site.slug),
      () => {
        removeSite(site.slug);
        toast('站点已删除');
      },
    );
  }

  return (
    <div className="group flex flex-col rounded-2xl border border-stone-200 bg-white shadow-card transition-shadow hover:shadow-lift">
      {/* 折叠头（始终显示）：点击展开/收起；右侧快捷复制/打开不触发展开 */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle()}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-stone-300 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate font-mono text-sm font-semibold text-stone-800">
            {site.slug}
          </span>
          {site.title && (
            <span className="hidden truncate text-xs text-stone-400 sm:inline">{site.title}</span>
          )}
        </span>
        {site.unresolved_comments > 0 && (
          <span
            title={`${site.unresolved_comments} 条未解决评论`}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200"
          >
            <MessageSquare className="h-3 w-3" />
            {site.unresolved_comments}
          </span>
        )}
        {isPublicLive ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-tide-50 px-2.5 py-1 text-xs font-medium text-tide-700 ring-1 ring-tide-200">
            <Globe2 className="h-3 w-3" />
            公开 · {remaining}
          </span>
        ) : isExpired ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-500 ring-1 ring-stone-200">
            <Lock className="h-3 w-3" />
            已过期
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600 ring-1 ring-stone-200">
            <Lock className="h-3 w-3" />
            私有
          </span>
        )}
        <span className="hidden shrink-0 text-xs text-stone-300 md:inline">
          {formatRelative(site.updated_at)}
        </span>
        <button
          type="button"
          title="复制链接"
          className="shrink-0 rounded p-1.5 text-stone-300 hover:bg-stone-100 hover:text-tide-700"
          onClick={(e) => {
            e.stopPropagation();
            void copyText(site.url).then((ok) =>
              ok ? toast('链接已复制') : toast('复制失败', 'err'),
            );
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <a
          href={site.url}
          target="_blank"
          rel="noreferrer"
          title="打开"
          className="shrink-0 rounded p-1.5 text-stone-300 hover:bg-stone-100 hover:text-tide-700"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {!expanded ? null : (
      <div className="px-5 pb-5">
      {/* URL 行 */}
      <div className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5">
        <a
          href={site.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate font-mono text-xs text-tide-700 hover:underline"
          title={site.url}
        >
          {site.url}
        </a>
        <button
          type="button"
          title="复制链接"
          className="rounded p-1 text-stone-400 hover:bg-white hover:text-tide-700"
          onClick={() => {
            void copyText(site.url).then((ok) =>
              ok ? toast('链接已复制') : toast('复制失败', 'err'),
            );
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <a
          href={site.url}
          target="_blank"
          rel="noreferrer"
          title="打开"
          className="rounded p-1 text-stone-400 hover:bg-white hover:text-tide-700"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="mt-3 text-xs text-stone-400">
        {site.file_count} 个文件 · {formatBytes(site.total_bytes)} · 更新于{' '}
        {formatRelative(site.updated_at)}
      </div>

      {/* 操作行 */}
      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-stone-100 pt-3">
        <button
          type="button"
          className={`btn-ghost !px-2.5 !py-1.5 !text-xs ${panel === 'share' ? '!border-tide-400 !text-tide-700' : ''}`}
          onClick={() => togglePanel('share')}
          disabled={busy}
        >
          <Globe2 className="h-3.5 w-3.5" />
          {isPublicLive ? '续期 / 转私有' : '公开分享'}
        </button>
        <button
          type="button"
          className="btn-ghost !px-2.5 !py-1.5 !text-xs"
          onClick={() => setDeployTarget(site.slug)}
          disabled={busy}
        >
          <UploadCloud className="h-3.5 w-3.5" />
          更新部署
        </button>
        <button
          type="button"
          className={`btn-ghost !px-2.5 !py-1.5 !text-xs ${panel === 'versions' ? '!border-tide-400 !text-tide-700' : ''}`}
          onClick={() => togglePanel('versions')}
          disabled={busy}
        >
          <History className="h-3.5 w-3.5" />
          版本
        </button>
        <button
          type="button"
          className={`btn-ghost !px-2.5 !py-1.5 !text-xs ${panel === 'settings' ? '!border-tide-400 !text-tide-700' : ''}`}
          onClick={() => togglePanel('settings')}
          disabled={busy}
        >
          <Settings2 className="h-3.5 w-3.5" />
          设置
        </button>
        <button
          type="button"
          className="btn-danger-ghost ml-auto !px-2.5 !py-1.5 !text-xs"
          onClick={() => void remove()}
          disabled={busy}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── 面板：公开分享 ── */}
      {panel === 'share' && (
        <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3 animate-fade-up">
          <div className="text-xs font-medium text-stone-500">
            {isPublicLive ? '续期（重新计时）' : '公开时长（到期自动转私有）'}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {shareOptions.map((o) => (
              <button
                key={o.hours}
                type="button"
                className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:border-tide-400 hover:text-tide-700 disabled:opacity-50"
                disabled={busy}
                onClick={() => makePublic(o.hours)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {isPublicLive && (
            <button
              type="button"
              className="mt-2 text-xs font-medium text-stone-500 underline-offset-2 hover:text-red-600 hover:underline"
              disabled={busy}
              onClick={makePrivate}
            >
              立即转为私有
            </button>
          )}
        </div>
      )}

      {/* ── 面板：设置 ── */}
      {panel === 'settings' && (
        <div className="mt-3 space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-3 animate-fade-up">
          <label className="flex cursor-pointer items-start justify-between gap-3">
            <span>
              <span className="block text-xs font-medium text-stone-700">页面评论</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-stone-400">
                已登录访问者可在页面上打点评论（匿名公开访客不可见）
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={site.comments_enabled}
              disabled={busy}
              onClick={() => toggleComments(!site.comments_enabled)}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                site.comments_enabled ? 'bg-tide-600' : 'bg-stone-300'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                  site.comments_enabled ? 'left-[18px]' : 'left-0.5'
                }`}
              />
            </button>
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-3">
            <span>
              <span className="block text-xs font-medium text-stone-700">SPA fallback</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-stone-400">
                单页应用路由：404 时回 index.html
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={site.spa_fallback}
              disabled={busy}
              onClick={() => toggleSpa(!site.spa_fallback)}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                site.spa_fallback ? 'bg-tide-600' : 'bg-stone-300'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                  site.spa_fallback ? 'left-[18px]' : 'left-0.5'
                }`}
              />
            </button>
          </label>
        </div>
      )}

      {/* ── 面板：版本 ── */}
      {panel === 'versions' && (
        <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3 animate-fade-up">
          {versionsLoading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-stone-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载版本…
            </div>
          ) : versions && versions.versions.length > 0 ? (
            <ul className="space-y-1.5">
              {versions.versions.map((v) => {
                const isCurrent = v.id === versions.current;
                return (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-2 ring-1 ring-stone-200"
                  >
                    <div className="min-w-0 text-xs">
                      <span className="font-mono text-stone-600">
                        {formatRelative(v.created_at)}
                      </span>
                      <span className="ml-2 text-stone-400">
                        {v.file_count} 文件 · {formatBytes(v.total_bytes)}
                      </span>
                    </div>
                    {isCurrent ? (
                      <span className="shrink-0 rounded-full bg-tide-50 px-2 py-0.5 text-[11px] font-medium text-tide-700 ring-1 ring-tide-200">
                        当前
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-stone-200 px-2 py-1 text-[11px] font-medium text-stone-500 hover:border-tide-400 hover:text-tide-700 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => rollback(v.id)}
                      >
                        回滚到此版本
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="py-2 text-xs text-stone-400">暂无历史版本</div>
          )}
        </div>
      )}
      </div>
      )}
    </div>
  );
}
