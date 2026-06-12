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
import { copyText, formatBytes } from '../lib/format';
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
      toast('没有收集到任何文件', 'err');
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
      toastError(err, '读取拖入内容失败');
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
      out.push('slug 需为 1-64 位小写字母 / 数字 / 中划线，且以字母或数字开头');
    if (files.length > limits.max_files)
      out.push(`文件数 ${files.length} 超过上限 ${limits.max_files} 个`);
    const maxFileBytes = limits.max_file_mb * 1024 * 1024;
    const tooBig = files.filter((f) => f.file.size > maxFileBytes);
    if (tooBig.length > 0)
      out.push(
        `${tooBig.length} 个文件超过单文件上限 ${limits.max_file_mb} MB（如 ${tooBig[0].relPath}）`,
      );
    const total = files.reduce((s, f) => s + f.file.size, 0);
    if (total > limits.max_site_mb * 1024 * 1024)
      out.push(`总大小 ${formatBytes(total)} 超过站点上限 ${limits.max_site_mb} MB`);
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
      toast('部署成功');
      void refreshSites();
    } catch (err) {
      toastError(err, '部署失败');
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
                <span className="text-lg font-semibold">部署完成</span>
              </div>
              <p className="mt-1 text-sm text-stone-500">
                {stage.site.file_count} 个文件 · {formatBytes(stage.site.total_bytes)}
                {stage.site.title ? ` · ${stage.site.title}` : ''}
              </p>
            </div>
            <button type="button" className="btn-ghost" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              再部署一个
            </button>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3">
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-tide-800">
              {stage.site.url}
            </span>
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5"
              onClick={() => {
                void copyText(stage.site.url).then((ok) =>
                  ok ? toast('链接已复制') : toast('复制失败', 'err'),
                );
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              复制链接
            </button>
            <a
              className="btn-primary !px-3 !py-1.5"
              href={stage.site.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              打开
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
              : 'border-stone-300 bg-white/70 shadow-card'
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
              <span className="mt-5 text-lg font-semibold text-stone-800">
                {dragOver ? '松手即上传' : '把文件或文件夹拖到这里'}
              </span>
              <span className="mt-1.5 text-sm text-stone-500">
                或点击选择文件 ·{' '}
                <span
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer font-medium text-tide-600 underline-offset-2 hover:underline"
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
                  选择整个文件夹
                </span>{' '}
                · 部署完成立刻得到分享链接
              </span>
              {slugLocked && (
                <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                  <Lock className="h-3 w-3" />
                  正在更新站点 {deployTarget}
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
                <span className="mt-6 text-xs text-stone-400">
                  单文件 ≤ {me.limits.max_file_mb} MB · 站点 ≤ {me.limits.max_site_mb} MB · ≤{' '}
                  {me.limits.max_files} 个文件
                </span>
              )}
            </button>
          )}

          {(stage.kind === 'ready' || stage.kind === 'uploading') && (
            <div className="p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-tide-50 text-tide-600">
                    {stage.collection.rootName ? (
                      <FolderUp className="h-5 w-5" />
                    ) : (
                      <FileBox className="h-5 w-5" />
                    )}
                  </span>
                  <div>
                    <div className="font-semibold text-stone-800">
                      {stage.collection.rootName
                        ? `文件夹「${stage.collection.rootName}」`
                        : '待部署内容'}
                    </div>
                    <div className="text-sm text-stone-500">
                      {stage.collection.files.length} 个文件 · {formatBytes(totalBytes)}
                    </div>
                  </div>
                </div>
                {stage.kind === 'ready' && (
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
                    onClick={reset}
                    title="清空"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* 文件清单（截断展示） */}
              <div className="mt-4 max-h-36 overflow-auto rounded-lg border border-stone-200 bg-stone-50 p-3 font-mono text-xs leading-relaxed text-stone-500">
                {stage.collection.files.slice(0, 50).map((f) => (
                  <div key={f.relPath} className="truncate">
                    {f.relPath}
                    <span className="text-stone-300"> · {formatBytes(f.file.size)}</span>
                  </div>
                ))}
                {stage.collection.files.length > 50 && (
                  <div className="text-stone-400">
                    …… 还有 {stage.collection.files.length - 50} 个文件
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-stone-500">
                    slug（链接路径）{slugLocked && '· 已锁定为更新目标'}
                  </span>
                  <input
                    className="input font-mono disabled:bg-stone-100 disabled:text-stone-500"
                    value={slug}
                    disabled={slugLocked || stage.kind === 'uploading'}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    placeholder="my-page"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-stone-500">
                    标题（可选）
                  </span>
                  <input
                    className="input"
                    value={title}
                    disabled={stage.kind === 'uploading'}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="给这个页面起个名字"
                  />
                </label>
              </div>

              <div className="mt-2 truncate font-mono text-xs text-stone-400">{previewUrl}</div>

              {stage.kind === 'ready' && problems.length > 0 && (
                <ul className="mt-3 space-y-1 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}

              {stage.kind === 'uploading' ? (
                <div className="mt-5">
                  <div className="flex items-center justify-between text-sm text-stone-600">
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-tide-600" />
                      正在上传…
                    </span>
                    <span className="font-mono">{stage.percent}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-200">
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
                  部署到 {slug || '…'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
