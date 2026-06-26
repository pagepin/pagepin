import { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  ExternalLink,
  FileBox,
  FolderUp,
  Loader2,
  Lock,
  Rocket,
  RotateCcw,
  UploadCloud,
  X,
} from 'lucide-react';
import { deploySite } from '../api';
import { slugify } from '../lib/collect';
import type { Collection } from '../lib/collect';
import { copyText, formatBytes, formatRelative } from '../lib/format';
import { useStore } from '../store';
import { SLUG_RE } from '../types';
import type { SiteOut } from '../types';
import { toast, toastError } from './Toast';

/**
 * 受控的部署面板内容。文件的「选取/拖入」由父级（SitesView）统一处理后，
 * 以 `collection` 注入；本组件只负责 slug/title 确认、limits 预校验、上传进度与成功态。
 * 这样「拖到页面任意位置」「空状态的按钮」「卡片上的 Redeploy」三条入口都汇到同一处。
 */
export function DropZone({
  collection,
  onClear,
  onChooseFiles,
  onChooseFolder,
  onDeployedChange,
}: {
  collection: Collection | null;
  onClear: () => void;
  onChooseFiles: () => void;
  onChooseFolder: () => void;
  /** 成功态进入/退出时通知父级，便于隐藏/恢复并排的 agent 副卡 */
  onDeployedChange?: (deployed: boolean) => void;
}) {
  const me = useStore((s) => s.me);
  const sites = useStore((s) => s.sites);
  const deployTarget = useStore((s) => s.deployTarget);
  const setDeployTarget = useStore((s) => s.setDeployTarget);
  const refreshSites = useStore((s) => s.refreshSites);
  const upsertSite = useStore((s) => s.upsertSite);

  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [percent, setPercent] = useState<number | null>(null); // null = 非上传中
  const [done, setDone] = useState<SiteOut | null>(null);

  const slugLocked = deployTarget !== null;
  const uploading = percent !== null;

  // 「更新部署」：锁定 slug 到目标，并清掉上一次成功态
  useEffect(() => {
    if (deployTarget) {
      setSlug(deployTarget);
      setDone(null);
    }
  }, [deployTarget]);

  // 新的内容到达 → 清成功态并推导 slug（锁定时不动）
  useEffect(() => {
    if (!collection) return;
    setDone(null);
    if (!slugLocked) {
      if (collection.rootName) setSlug(slugify(collection.rootName));
      else setSlug((cur) => cur || slugify(collection.files[0].file.name.replace(/\.[^.]+$/, '')));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection]);

  // 前端预校验 limits
  const problems = useMemo(() => {
    if (!collection || !me) return [];
    const { limits } = me;
    const out: string[] = [];
    const files = collection.files;
    if (!SLUG_RE.test(slug))
      out.push(
        'Slug must be 1–64 chars: lowercase letters, digits, or hyphens, starting with a letter or digit',
      );
    if (files.length > limits.max_files)
      out.push(`${files.length} files exceeds the limit of ${limits.max_files}`);
    const maxFileBytes = limits.max_file_mb * 1024 * 1024;
    const tooBig = files.filter((f) => f.file.size > maxFileBytes);
    if (tooBig.length > 0)
      out.push(
        `${tooBig.length} file(s) exceed the ${limits.max_file_mb} MB per-file limit (e.g. ${tooBig[0].relPath})`,
      );
    const total = files.reduce((s, f) => s + f.file.size, 0);
    if (total > limits.max_site_mb * 1024 * 1024)
      out.push(`Total size ${formatBytes(total)} exceeds the ${limits.max_site_mb} MB site limit`);
    return out;
  }, [collection, slug, me]);

  async function deploy() {
    if (!collection || problems.length > 0 || uploading) return;
    const files = collection.files;
    setPercent(0);
    try {
      const site = await deploySite(slug, files, title || undefined, (p) => setPercent(p));
      upsertSite(site);
      setDone(site);
      onDeployedChange?.(true);
      setPercent(null);
      setDeployTarget(null);
      setTitle('');
      onClear();
      toast('Deployed');
      void refreshSites();
    } catch (err) {
      toastError(err, 'Deploy failed');
      setPercent(null);
    }
  }

  function clearSelection() {
    onClear();
    setSlug(deployTarget ?? '');
    setTitle('');
  }

  function deployAnother() {
    setDone(null);
    onDeployedChange?.(false);
    setSlug('');
    setTitle('');
    setDeployTarget(null);
    onClear();
  }

  const totalBytes = collection ? collection.files.reduce((s, f) => s + f.file.size, 0) : 0;
  const previewUrl = me
    ? `${me.content_base.replace(/\/$/, '')}/${me.handle}/${slug || '<slug>'}/`
    : '';
  // slug 撞上已有站点 = 这次部署是「更新」：部署前就说明白
  const existing = collection && slug ? (sites.find((x) => x.slug === slug) ?? null) : null;

  // ── 成功态 ─────────────────────────────────
  if (done) {
    return (
      <section className="animate-fade-up rounded-card border border-tide-200 bg-gradient-to-b from-tide-50 to-white p-6 shadow-card lg:col-span-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-tide-700">
              <Rocket className="h-5 w-5" />
              <span className="text-lg font-semibold">Deployed</span>
            </div>
            <p className="mt-1 text-sm text-ink-500">
              {done.file_count} {done.file_count === 1 ? 'file' : 'files'} ·{' '}
              {formatBytes(done.total_bytes)}
              {done.title ? ` · ${done.title}` : ''}
            </p>
          </div>
          <button type="button" className="btn-ghost shrink-0" onClick={deployAnother}>
            <RotateCcw className="h-4 w-4" />
            Deploy another
          </button>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-panel border border-ink-200 bg-white px-4 py-3">
          <a
            className="min-w-0 flex-1 truncate font-mono text-sm text-tide-800 underline-offset-2 hover:underline"
            href={done.url}
            target="_blank"
            rel="noreferrer"
            title={done.url}
          >
            {done.url}
          </a>
          <button
            type="button"
            className="btn-ghost !px-3 !py-1.5"
            onClick={() => {
              void copyText(done.url).then((ok) =>
                ok ? toast('Link copied') : toast('Copy failed', 'err'),
              );
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy link
          </button>
          <a className="btn-primary !px-3 !py-1.5" href={done.url} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
            Open
          </a>
        </div>
      </section>
    );
  }

  // ── 待确认 / 上传中 ────────────────────────
  if (collection) {
    return (
      <section className="animate-fade-up rounded-card border border-ink-200 bg-white p-5 shadow-card lg:col-span-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-panel bg-tide-50 text-tide-600">
              {collection.rootName ? (
                <FolderUp className="h-5 w-5" />
              ) : (
                <FileBox className="h-5 w-5" />
              )}
            </span>
            <div>
              <div className="font-semibold text-ink-800">
                {collection.rootName ? `Folder “${collection.rootName}”` : 'Files to deploy'}
              </div>
              <div className="text-sm text-ink-500">
                {collection.files.length} {collection.files.length === 1 ? 'file' : 'files'} ·{' '}
                {formatBytes(totalBytes)}
              </div>
            </div>
          </div>
          {!uploading && (
            <button
              type="button"
              className="rounded-field p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
              onClick={clearSelection}
              title="Clear"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 文件清单（截断展示） */}
        <div className="mt-4 max-h-36 overflow-auto rounded-field border border-ink-200 bg-ink-50 p-3 font-mono text-xs leading-relaxed text-ink-500">
          {collection.files.slice(0, 50).map((f) => (
            <div key={f.relPath} className="truncate">
              {f.relPath}
              <span className="text-ink-300"> · {formatBytes(f.file.size)}</span>
            </div>
          ))}
          {collection.files.length > 50 && (
            <div className="text-ink-400">… and {collection.files.length - 50} more files</div>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-500">
              Slug (link path){slugLocked && ' · locked to update target'}
            </span>
            <input
              className="input font-mono disabled:bg-ink-100 disabled:text-ink-500"
              value={slug}
              disabled={slugLocked || uploading}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="my-page"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-500">Title (optional)</span>
            <input
              className="input"
              value={title}
              disabled={uploading}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Name this page"
            />
          </label>
        </div>

        <div className="mt-2 truncate font-mono text-xs text-ink-400">{previewUrl}</div>

        {!uploading && existing && !slugLocked && (
          <div className="mt-3 rounded-field border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
            Slug “{slug}” is already taken by your site <b>“{existing.title || existing.slug}”</b> —
            this deploy will publish as a <b>new version</b> of it (currently {existing.file_count}{' '}
            files, updated {formatRelative(existing.updated_at)};{' '}
            {me && me.limits.keep_versions > 0
              ? `only the last ${me.limits.keep_versions} versions are kept`
              : 'older versions stay rollback-able'}
            ). To create a separate site, change the slug.
          </div>
        )}

        {!uploading && problems.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-field border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        {uploading ? (
          <div className="mt-5">
            <div className="flex items-center justify-between text-sm text-ink-600">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-tide-600" />
                Uploading…
              </span>
              <span className="font-mono">{percent}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-200">
              <div
                className="h-full rounded-full bg-tide-500 transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn-primary mt-5 w-full sm:w-auto"
            disabled={problems.length > 0}
            onClick={() => void deploy()}
          >
            <Rocket className="h-4 w-4" />
            {existing ? `Update site ${slug}` : `Deploy to ${slug || '…'}`}
          </button>
        )}
      </section>
    );
  }

  // ── 空闲：紧凑投放区（点击=选文件；也可拖到页面任意位置）──
  return (
    <button
      type="button"
      onClick={onChooseFiles}
      className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-tide-300 bg-tide-50/40 px-5 py-6 text-center transition-colors hover:border-tide-500 hover:bg-tide-50"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-panel bg-tide-600 text-white shadow-[0_10px_22px_-10px_rgba(15,124,114,0.7)]">
        <UploadCloud className="h-5 w-5" />
      </span>
      <span className="text-[15px] font-bold text-ink-800">Drop files or a folder here</span>
      <span className="max-w-[370px] text-xs leading-relaxed text-ink-500">
        HTML · Markdown · images · build output — or{' '}
        <span
          role="button"
          tabIndex={0}
          className="cursor-pointer font-semibold text-tide-600 underline-offset-2 hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            onChooseFolder();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              onChooseFolder();
            }
          }}
        >
          choose a whole folder
        </span>
        . Each deploy is an atomic, versioned release.
      </span>
      {slugLocked ? (
        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
          <Lock className="h-3 w-3" />
          Updating site {deployTarget}
          <span
            role="button"
            tabIndex={0}
            className="ml-1 cursor-pointer text-amber-500 hover:text-amber-700"
            onClick={(e) => {
              e.stopPropagation();
              setDeployTarget(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                setDeployTarget(null);
              }
            }}
          >
            <X className="h-3 w-3" />
          </span>
        </span>
      ) : me ? (
        <span className="text-[11px] text-ink-400">
          Single file ≤ {me.limits.max_file_mb} MB · up to {me.limits.max_files} files · drop
          anywhere on this page
        </span>
      ) : null}
    </button>
  );
}
