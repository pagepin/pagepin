import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  ExternalLink,
  FileBox,
  FolderUp,
  Loader2,
  Lock,
  RotateCcw,
  Rocket,
  UploadCloud,
  X,
} from 'lucide-react';
import { deploySite } from '../api';
import { collectFromDataTransfer, collectFromFileList, slugify } from '../lib/collect';
import type { Collection } from '../lib/collect';
import { copyText, formatBytes, formatRelative } from '../lib/format';
import { useStore } from '../store';
import { SLUG_RE } from '../types';
import type { SiteOut } from '../types';
import { toast, toastError } from './Toast';

type Stage =
  | { kind: 'idle' }
  | { kind: 'ready'; collection: Collection }
  | { kind: 'uploading'; collection: Collection; percent: number }
  | { kind: 'done'; site: SiteOut };

export function DropZone() {
  const me = useStore((s) => s.me);
  const sites = useStore((s) => s.sites);
  const deployTarget = useStore((s) => s.deployTarget);
  const setDeployTarget = useStore((s) => s.setDeployTarget);
  const refreshSites = useStore((s) => s.refreshSites);
  const upsertSite = useStore((s) => s.upsertSite);

  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const dragDepth = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const slugLocked = deployTarget !== null;

  // 「更新部署」：锁定 slug 并滚动到 drop zone
  useEffect(() => {
    if (deployTarget) {
      setSlug(deployTarget);
      setStage((s) => (s.kind === 'done' ? { kind: 'idle' } : s));
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [deployTarget]);

  function applyCollection(collection: Collection) {
    if (collection.files.length === 0) {
      toast('No files were collected', 'err');
      return;
    }
    if (!slugLocked) {
      if (collection.rootName) setSlug(slugify(collection.rootName));
      else if (!slug) setSlug(slugify(collection.files[0].file.name.replace(/\.[^.]+$/, '')));
    }
    setStage({ kind: 'ready', collection });
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (stage.kind === 'uploading') return;
    try {
      const collection = await collectFromDataTransfer(e.dataTransfer);
      applyCollection(collection);
    } catch (err) {
      toastError(err, 'Failed to read dropped content');
    }
  }

  // 文件选择与文件夹选择共用:collectFromFileList 对平铺 FileList(无 webkitRelativePath)
  // 自然退化为按文件名收集
  function onPickInput(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (list && list.length > 0) applyCollection(collectFromFileList(list));
    e.target.value = '';
  }

  // 前端预校验 limits
  const problems = useMemo(() => {
    if (stage.kind !== 'ready' || !me) return [];
    const { limits } = me;
    const out: string[] = [];
    const files = stage.collection.files;
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
  }, [stage, slug, me]);

  async function deploy() {
    if (stage.kind !== 'ready' || problems.length > 0) return;
    const collection = stage.collection;
    setStage({ kind: 'uploading', collection, percent: 0 });
    try {
      const site = await deploySite(slug, collection.files, title || undefined, (percent) =>
        setStage({ kind: 'uploading', collection, percent }),
      );
      upsertSite(site);
      setStage({ kind: 'done', site });
      setDeployTarget(null);
      setTitle('');
      toast('Deployed');
      void refreshSites();
    } catch (err) {
      toastError(err, 'Deploy failed');
      setStage({ kind: 'ready', collection });
    }
  }

  function reset() {
    setStage({ kind: 'idle' });
    setSlug('');
    setTitle('');
    setDeployTarget(null);
  }

  const totalBytes =
    stage.kind === 'ready' || stage.kind === 'uploading'
      ? stage.collection.files.reduce((s, f) => s + f.file.size, 0)
      : 0;

  const previewUrl = me
    ? `${me.content_base.replace(/\/$/, '')}/${me.handle}/${slug || '<slug>'}/`
    : '';

  // slug 撞上已有站点 = 这次部署是「更新」:部署前就把话说明白,而不是事后惊讶
  const existing =
    (stage.kind === 'ready' || stage.kind === 'uploading') && slug
      ? (sites.find((x) => x.slug === slug) ?? null)
      : null;

  return (
    <section ref={rootRef} className="animate-fade-up">
      {/* 两个隐藏 input:webkitdirectory 的对话框只能选文件夹(html/md 等文件是灰的),
          单文件/多文件必须走这个不带它的普通 input */}
      <input ref={fileInputRef} type="file" className="hidden" multiple onChange={onPickInput} />
      <input
        ref={dirInputRef}
        type="file"
        className="hidden"
        // @ts-expect-error 非标准属性，Chrome/Edge/Safari 均支持
        webkitdirectory=""
        multiple
        onChange={onPickInput}
      />

      {/* ── 结果卡 ─────────────────────────────── */}
      {stage.kind === 'done' ? (
        <div className="rounded-2xl border border-tide-200 bg-gradient-to-b from-tide-50 to-white p-8 shadow-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-tide-700">
                <Rocket className="h-5 w-5" />
                <span className="text-lg font-semibold">Deployed</span>
              </div>
              <p className="mt-1 text-sm text-ink-500">
                {stage.site.file_count} {stage.site.file_count === 1 ? 'file' : 'files'} ·{' '}
                {formatBytes(stage.site.total_bytes)}
                {stage.site.title ? ` · ${stage.site.title}` : ''}
              </p>
            </div>
            <button type="button" className="btn-ghost" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              Deploy another
            </button>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2 rounded-panel border border-ink-200 bg-white px-4 py-3">
            <a
              className="min-w-0 flex-1 truncate font-mono text-sm text-tide-800 underline-offset-2 hover:underline"
              href={stage.site.url}
              target="_blank"
              rel="noreferrer"
              title={stage.site.url}
            >
              {stage.site.url}
            </a>
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5"
              onClick={() => {
                void copyText(stage.site.url).then((ok) =>
                  ok ? toast('Link copied') : toast('Copy failed', 'err'),
                );
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy link
            </button>
            <a
              className="btn-primary !px-3 !py-1.5"
              href={stage.site.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </a>
          </div>
        </div>
      ) : (
        /* ── drop zone ───────────────────────────── */
        <div
          onDragEnter={(e) => {
            e.preventDefault();
            dragDepth.current += 1;
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            dragDepth.current -= 1;
            if (dragDepth.current <= 0) setDragOver(false);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => void onDrop(e)}
          className={`relative overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-200 ${
            dragOver
              ? 'border-tide-500 bg-tide-50 shadow-lift'
              : 'border-ink-300 bg-white/70 shadow-card'
          }`}
        >
          {stage.kind === 'idle' && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center px-6 py-14 text-center focus:outline-none sm:py-20"
            >
              <span
                className={`flex h-16 w-16 items-center justify-center rounded-2xl transition-colors ${
                  dragOver ? 'bg-tide-600 text-white' : 'bg-tide-50 text-tide-600'
                }`}
              >
                <UploadCloud className="h-8 w-8" />
              </span>
              <span className="mt-5 text-lg font-semibold text-ink-800">
                {dragOver ? 'Release to upload' : 'Drop files or a folder here'}
              </span>
              <span className="mt-1.5 text-sm text-ink-500">
                or click to choose files ·{' '}
                <span
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer font-semibold text-tide-600 underline-offset-2 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    dirInputRef.current?.click();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      dirInputRef.current?.click();
                    }
                  }}
                >
                  choose a whole folder
                </span>{' '}
                · get a shareable link the moment it deploys
              </span>
              {slugLocked && (
                <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                  <Lock className="h-3 w-3" />
                  Updating site {deployTarget}
                  <span
                    role="button"
                    tabIndex={0}
                    className="ml-1 cursor-pointer text-amber-500 hover:text-amber-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      reset();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        reset();
                      }
                    }}
                  >
                    <X className="h-3 w-3" />
                  </span>
                </span>
              )}
              {me && (
                <span className="mt-6 text-xs text-ink-400">
                  Single file ≤ {me.limits.max_file_mb} MB · site ≤ {me.limits.max_site_mb} MB · ≤{' '}
                  {me.limits.max_files} files
                </span>
              )}
            </button>
          )}

          {(stage.kind === 'ready' || stage.kind === 'uploading') && (
            <div className="p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-panel bg-tide-50 text-tide-600">
                    {stage.collection.rootName ? (
                      <FolderUp className="h-5 w-5" />
                    ) : (
                      <FileBox className="h-5 w-5" />
                    )}
                  </span>
                  <div>
                    <div className="font-semibold text-ink-800">
                      {stage.collection.rootName
                        ? `Folder “${stage.collection.rootName}”`
                        : 'Files to deploy'}
                    </div>
                    <div className="text-sm text-ink-500">
                      {stage.collection.files.length}{' '}
                      {stage.collection.files.length === 1 ? 'file' : 'files'} ·{' '}
                      {formatBytes(totalBytes)}
                    </div>
                  </div>
                </div>
                {stage.kind === 'ready' && (
                  <button
                    type="button"
                    className="rounded-field p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
                    onClick={reset}
                    title="Clear"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* 文件清单（截断展示） */}
              <div className="mt-4 max-h-36 overflow-auto rounded-field border border-ink-200 bg-ink-50 p-3 font-mono text-xs leading-relaxed text-ink-500">
                {stage.collection.files.slice(0, 50).map((f) => (
                  <div key={f.relPath} className="truncate">
                    {f.relPath}
                    <span className="text-ink-300"> · {formatBytes(f.file.size)}</span>
                  </div>
                ))}
                {stage.collection.files.length > 50 && (
                  <div className="text-ink-400">
                    … and {stage.collection.files.length - 50} more files
                  </div>
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
                    disabled={slugLocked || stage.kind === 'uploading'}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    placeholder="my-page"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-ink-500">
                    Title (optional)
                  </span>
                  <input
                    className="input"
                    value={title}
                    disabled={stage.kind === 'uploading'}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Name this page"
                  />
                </label>
              </div>

              <div className="mt-2 truncate font-mono text-xs text-ink-400">{previewUrl}</div>

              {stage.kind === 'ready' && existing && !slugLocked && (
                <div className="mt-3 rounded-field border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
                  Slug “{slug}” is already taken by your site{' '}
                  <b>“{existing.title || existing.slug}”</b> — this deploy will publish as a{' '}
                  <b>new version</b> of it (currently {existing.file_count} files, updated{' '}
                  {formatRelative(existing.updated_at)}; older versions stay rollback-able). To
                  create a separate site, change the slug.
                </div>
              )}

              {stage.kind === 'ready' && problems.length > 0 && (
                <ul className="mt-3 space-y-1 rounded-field border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}

              {stage.kind === 'uploading' ? (
                <div className="mt-5">
                  <div className="flex items-center justify-between text-sm text-ink-600">
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-tide-600" />
                      Uploading…
                    </span>
                    <span className="font-mono">{stage.percent}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-200">
                    <div
                      className="h-full rounded-full bg-tide-500 transition-[width] duration-200"
                      style={{ width: `${stage.percent}%` }}
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
            </div>
          )}
        </div>
      )}
    </section>
  );
}
