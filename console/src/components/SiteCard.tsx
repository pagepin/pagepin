import { useState } from 'react';
import {
  Ban,
  ChevronRight,
  Clock,
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
  { label: '1 hour', hours: 1 },
  { label: '6 hours', hours: 6 },
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
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
        .catch((e) => toastError(e, 'Failed to load versions'))
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
        toast(
          `Public now — auto-reverts to private in ${
            SHARE_OPTIONS.find((o) => o.hours === hours)?.label ?? hours + 'h'
          }`,
        );
      },
    );
  }

  function makePrivate() {
    void run(
      () => api.patchSite(site.slug, { visibility: 'private' }),
      (updated) => {
        upsertSite(updated);
        setPanel(null);
        toast('Switched to private');
      },
    );
  }

  function toggleSpa(next: boolean) {
    void run(
      () => api.patchSite(site.slug, { spa_fallback: next }),
      (updated) => {
        upsertSite(updated);
        toast(next ? 'SPA fallback enabled' : 'SPA fallback disabled');
      },
    );
  }

  function toggleComments(next: boolean) {
    void run(
      () => api.patchSite(site.slug, { comments_enabled: next }),
      (updated) => {
        upsertSite(updated);
        toast(next ? 'Page comments enabled' : 'Page comments disabled');
      },
    );
  }

  function rollback(versionId: string) {
    void run(
      () => api.rollback(site.slug, versionId),
      (updated) => {
        upsertSite(updated);
        setPanel(null);
        toast('Rolled back to the selected version');
      },
    );
  }

  async function remove() {
    const ok = await confirmDanger({
      title: `Delete site “${site.slug}”?`,
      body: 'The site and all its version history will be deleted, the link stops working immediately, and this cannot be undone.',
      confirmText: 'Delete site',
    });
    if (!ok) return;
    void run(
      () => api.deleteSite(site.slug),
      () => {
        removeSite(site.slug);
        toast('Site deleted');
      },
    );
  }

  return (
    <div
      data-testid="site-card"
      data-slug={site.slug}
      className="group flex flex-col rounded-card border border-ink-200 bg-white shadow-card transition-shadow hover:shadow-lift"
    >
      {/* 折叠头（始终显示）：点击展开/收起；右侧快捷复制/打开不触发展开 */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle()}
        className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-ink-300 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate font-mono text-sm font-semibold text-ink-800">{site.slug}</span>
          {site.title && (
            <span className="hidden truncate text-xs text-ink-400 sm:inline">{site.title}</span>
          )}
        </span>
        {site.unresolved_comments > 0 && (
          <span
            title={`${site.unresolved_comments} unresolved comments`}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200"
          >
            <MessageSquare className="h-3 w-3" />
            {site.unresolved_comments}
          </span>
        )}
        {site.suspended ? (
          <span
            title="Disabled by an administrator — returns 451 to everyone"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 ring-1 ring-red-200"
          >
            <Ban className="h-3 w-3" />
            Disabled
          </span>
        ) : isPublicLive ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-tide-50 px-2.5 py-1 text-xs font-semibold text-tide-700 ring-1 ring-tide-200">
            <Globe2 className="h-3 w-3" />
            Public · {remaining}
          </span>
        ) : isExpired ? (
          <span
            title="Public window ended — reverted to private"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs font-semibold text-ink-500 ring-1 ring-ink-200"
          >
            <Clock className="h-3 w-3" />
            Reverted
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs font-semibold text-ink-600 ring-1 ring-ink-200">
            <Lock className="h-3 w-3" />
            Private
          </span>
        )}
        <span className="hidden shrink-0 text-xs text-ink-400 md:inline">
          {formatRelative(site.updated_at)}
        </span>
        <button
          type="button"
          title="Copy link"
          className="shrink-0 rounded-chip p-1.5 text-ink-300 hover:bg-ink-100 hover:text-tide-700"
          onClick={(e) => {
            e.stopPropagation();
            void copyText(site.url).then((ok) =>
              ok ? toast('Link copied') : toast('Copy failed', 'err'),
            );
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <a
          href={site.url}
          target="_blank"
          rel="noreferrer"
          title="Open"
          className="shrink-0 rounded-chip p-1.5 text-ink-300 hover:bg-ink-100 hover:text-tide-700"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {!expanded ? null : (
        <div className="px-5 pb-5">
          {site.suspended && (
            <div className="mb-3 rounded-panel border border-red-200 bg-red-50 p-3 text-xs">
              <div className="font-semibold text-red-700">
                This page has been disabled by an administrator.
              </div>
              <div className="mt-0.5 leading-relaxed text-red-600">
                It returns 451 to all visitors and redeploys won&rsquo;t restore it.
                {site.suspended_reason ? ` Reason: ${site.suspended_reason}.` : ''} Contact the
                instance operator to appeal.
              </div>
            </div>
          )}
          {/* URL 行 */}
          <div className="flex items-center gap-1.5 rounded-field border border-ink-200 bg-ink-50 px-2.5 py-1.5">
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
              title="Copy link"
              className="rounded-chip p-1 text-ink-400 hover:bg-white hover:text-tide-700"
              onClick={() => {
                void copyText(site.url).then((ok) =>
                  ok ? toast('Link copied') : toast('Copy failed', 'err'),
                );
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <a
              href={site.url}
              target="_blank"
              rel="noreferrer"
              title="Open"
              className="rounded-chip p-1 text-ink-400 hover:bg-white hover:text-tide-700"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <div className="mt-3 text-xs text-ink-400">
            {site.file_count} {site.file_count === 1 ? 'file' : 'files'} ·{' '}
            {formatBytes(site.total_bytes)} · updated {formatRelative(site.updated_at)}
          </div>

          {/* 操作行 */}
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-ink-100 pt-3">
            <button
              type="button"
              className={`btn-ghost !px-2.5 !py-1.5 !text-xs ${panel === 'share' ? '!border-tide-300 !text-tide-700' : ''}`}
              onClick={() => togglePanel('share')}
              disabled={busy}
            >
              <Globe2 className="h-3.5 w-3.5" />
              {isPublicLive ? 'Renew / make private' : 'Share publicly'}
            </button>
            <button
              type="button"
              className="btn-ghost !px-2.5 !py-1.5 !text-xs"
              onClick={() => setDeployTarget(site.slug)}
              disabled={busy}
            >
              <UploadCloud className="h-3.5 w-3.5" />
              Redeploy
            </button>
            <button
              type="button"
              className={`btn-ghost !px-2.5 !py-1.5 !text-xs ${panel === 'versions' ? '!border-tide-300 !text-tide-700' : ''}`}
              onClick={() => togglePanel('versions')}
              disabled={busy}
            >
              <History className="h-3.5 w-3.5" />
              Versions
            </button>
            <button
              type="button"
              className={`btn-ghost !px-2.5 !py-1.5 !text-xs ${panel === 'settings' ? '!border-tide-300 !text-tide-700' : ''}`}
              onClick={() => togglePanel('settings')}
              disabled={busy}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Settings
            </button>
            <button
              type="button"
              className="btn-danger-ghost ml-auto !px-2.5 !py-1.5 !text-xs"
              onClick={() => void remove()}
              disabled={busy}
              title="Delete site"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* ── 面板：公开分享 ── */}
          {panel === 'share' && (
            <div className="mt-3 rounded-panel border border-ink-200 bg-ink-50 p-3 animate-fade-up">
              <div className="text-xs font-semibold text-ink-500">
                {isPublicLive ? 'Renew (resets the timer)' : 'Public for (auto-reverts to private)'}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {shareOptions.map((o) => (
                  <button
                    key={o.hours}
                    type="button"
                    className="rounded-field border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 hover:border-tide-300 hover:text-tide-700 disabled:opacity-50"
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
                  className="mt-2 text-xs font-semibold text-ink-500 underline-offset-2 hover:text-red-600 hover:underline"
                  disabled={busy}
                  onClick={makePrivate}
                >
                  Make private now
                </button>
              )}
            </div>
          )}

          {/* ── 面板：设置 ── */}
          {panel === 'settings' && (
            <div className="mt-3 space-y-3 rounded-panel border border-ink-200 bg-ink-50 p-3 animate-fade-up">
              <label className="flex cursor-pointer items-start justify-between gap-3">
                <span>
                  <span className="block text-xs font-semibold text-ink-700">Page comments</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">
                    Signed-in visitors can pin review comments on the page (hidden from anonymous
                    public visitors).
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={site.comments_enabled}
                  disabled={busy}
                  onClick={() => toggleComments(!site.comments_enabled)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    site.comments_enabled ? 'bg-tide-600' : 'bg-ink-300'
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
                  <span className="block text-xs font-semibold text-ink-700">SPA fallback</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">
                    Single-page app routing: serve index.html on a 404.
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={site.spa_fallback}
                  disabled={busy}
                  onClick={() => toggleSpa(!site.spa_fallback)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    site.spa_fallback ? 'bg-tide-600' : 'bg-ink-300'
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
            <div className="mt-3 rounded-panel border border-ink-200 bg-ink-50 p-3 animate-fade-up">
              {versionsLoading ? (
                <div className="flex items-center gap-2 py-2 text-xs text-ink-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading versions…
                </div>
              ) : versions && versions.versions.length > 0 ? (
                <ul className="space-y-1.5">
                  {versions.versions.map((v) => {
                    const isCurrent = v.id === versions.current;
                    return (
                      <li
                        key={v.id}
                        className="flex items-center justify-between gap-2 rounded-field bg-white px-2.5 py-2 ring-1 ring-ink-200"
                      >
                        <div className="min-w-0 text-xs">
                          <span className="font-mono text-ink-600">
                            {formatRelative(v.created_at)}
                          </span>
                          <span className="ml-2 text-ink-400">
                            {v.file_count} {v.file_count === 1 ? 'file' : 'files'} ·{' '}
                            {formatBytes(v.total_bytes)}
                          </span>
                        </div>
                        {isCurrent ? (
                          <span className="shrink-0 rounded-full bg-tide-50 px-2 py-0.5 text-[11px] font-semibold text-tide-700 ring-1 ring-tide-200">
                            Current
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="shrink-0 rounded-field border border-ink-200 px-2 py-1 text-[11px] font-semibold text-ink-600 hover:border-tide-300 hover:text-tide-700 disabled:opacity-50"
                            disabled={busy}
                            onClick={() => rollback(v.id)}
                          >
                            Roll back
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="py-2 text-xs text-ink-400">No previous versions</div>
              )}
              {me && me.limits.keep_versions > 0 && versions && versions.versions.length > 0 && (
                <p className="mt-2 px-0.5 text-[11px] leading-relaxed text-ink-400">
                  Keeping the last {me.limits.keep_versions} versions — older ones are removed
                  automatically (files deleted, not recoverable).
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
