import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Search, UploadCloud } from 'lucide-react';
import { collectFromDataTransfer, collectFromFileList } from '../lib/collect';
import type { Collection } from '../lib/collect';
import { copyText } from '../lib/format';
import { useStore } from '../store';
import { AgentDeployCard, INSTALL_CMD } from './AgentDeployCard';
import { DropZone } from './DropZone';
import { SiteCard } from './SiteCard';
import { toast, toastError } from './Toast';

/** 空状态：首个站点的投放入口（拖到页面任意位置同样有效）。 */
function EmptyState({ onPick, onCopyInstall }: { onPick: () => void; onCopyInstall: () => void }) {
  return (
    <section className="animate-fade-up">
      <h2 className="mb-4 flex items-baseline gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-ink-500">My sites</span>
        <span className="font-mono text-xs text-ink-400">0</span>
      </h2>
      <div className="rounded-card border border-dashed border-ink-300 bg-white px-7 py-12 text-center">
        <div className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-panel bg-tide-50 text-tide-600">
          <UploadCloud className="h-6 w-6" />
        </div>
        <div className="mt-4 text-[15px] font-semibold text-ink-700">No sites yet</div>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-400">
          Drop an HTML or Markdown file — or a whole folder — to publish your first page. You&rsquo;ll
          get a shareable link the moment it lands.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <button type="button" className="btn-primary" onClick={onPick}>
            <UploadCloud className="h-4 w-4" />
            Drop your first file
          </button>
          <button type="button" className="btn-ghost" onClick={onCopyInstall}>
            Deploying from an agent?{' '}
            <span className="font-mono text-tide-600">npx skills add pagepin</span>
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * Sites 主屏：统一的工具栏（My sites + 搜索 + Deploy 折叠开关）、可折叠的部署面板
 * （紧凑投放区 + AI agent 副卡）、站点行/空状态，以及覆盖整页的「拖到任意位置即部署」浮层。
 */
export function SitesView() {
  const sites = useStore((s) => s.sites);
  const loading = useStore((s) => s.loadingSites);
  const deployTarget = useStore((s) => s.deployTarget);

  // 公开倒计时用的时钟，30s 一跳
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const [query, setQuery] = useState('');
  // 展开集合：null = 首次未初始化（站点 ≤3 个时自动全展开，多了默认全折叠）
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

  // 部署面板：日常折叠，按需展开（Redeploy / 选取 / 拖入都会自动展开）
  const [deployOpen, setDeployOpen] = useState(false);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [deployed, setDeployed] = useState(false); // 刚部署成功 → 让面板只显示成功卡
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  // 来自站点卡的 Redeploy → 打开面板（DropZone 监听 deployTarget 锁定 slug）
  useEffect(() => {
    if (deployTarget) setDeployOpen(true);
  }, [deployTarget]);

  // 关闭面板即清掉成功态，下次展开回到投放邀请（含 agent 副卡）
  useEffect(() => {
    if (!deployOpen) setDeployed(false);
  }, [deployOpen]);

  const openFiles = () => filesInput.current?.click();
  const openFolder = () => folderInput.current?.click();

  // 文件/文件夹选择共用：平铺 FileList 自然按文件名收集
  function onPickInput(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (list && list.length > 0) {
      setCollection(collectFromFileList(list));
      setDeployOpen(true);
    }
    e.target.value = '';
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    try {
      const c = await collectFromDataTransfer(e.dataTransfer);
      if (c.files.length === 0) {
        toast('No files were collected', 'err');
        return;
      }
      setCollection(c);
      setDeployOpen(true);
    } catch (err) {
      toastError(err, 'Failed to read dropped content');
    }
  }

  const copyInstall = () => {
    void copyText(INSTALL_CMD).then((ok) =>
      ok ? toast('Copied — run it in your terminal') : toast('Copy failed', 'err'),
    );
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sites.filter(
        (s) => s.slug.toLowerCase().includes(q) || (s.title ?? '').toLowerCase().includes(q),
      )
    : sites;

  // 空状态：尚无站点且没有待部署的内容时，只显示空卡（拖放浮层仍可用）
  const showEmpty = sites.length === 0 && !loading && !collection;
  const showPanel = deployOpen || collection != null;

  return (
    <main
      className="relative mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8"
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={(e) => void onDrop(e)}
    >
      {/* 隐藏 input：webkitdirectory 只能选文件夹，单/多文件走不带它的普通 input */}
      <input ref={filesInput} type="file" className="hidden" multiple onChange={onPickInput} />
      <input
        ref={folderInput}
        type="file"
        className="hidden"
        // @ts-expect-error 非标准属性，Chrome/Edge/Safari 均支持
        webkitdirectory=""
        multiple
        onChange={onPickInput}
      />

      {showEmpty ? (
        <EmptyState onPick={openFiles} onCopyInstall={copyInstall} />
      ) : (
        <>
          {/* 工具栏：My sites · 计数 / 搜索 · Deploy 折叠开关 */}
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex shrink-0 items-baseline gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-ink-500">
                My sites
              </span>
              <span className="font-mono text-xs text-ink-400">{sites.length}</span>
            </h2>
            <div className="flex items-center gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin text-ink-400" />}
              {sites.length > 0 && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
                  <input
                    data-testid="site-list-search"
                    className="input !w-44 !py-1.5 !pl-8 !text-xs sm:!w-52"
                    placeholder="Search slug / title"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              )}
              <button
                type="button"
                aria-expanded={deployOpen}
                onClick={() => setDeployOpen((v) => !v)}
                className={`btn !px-3.5 !py-2 !text-[13px] ${
                  deployOpen
                    ? 'border border-tide-200 bg-white text-tide-700'
                    : 'bg-tide-600 text-white shadow-[0_8px_18px_-10px_rgba(15,124,114,0.7)] hover:bg-tide-700'
                }`}
              >
                <UploadCloud className="h-3.5 w-3.5" />
                Deploy
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${deployOpen ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
          </div>

          {/* 折叠的部署面板：紧凑投放区 + AI agent 副卡 */}
          {showPanel && (
            <div className="mb-5 grid animate-fade-up gap-3 lg:grid-cols-[1.55fr_1fr]">
              <DropZone
                collection={collection}
                onClear={() => setCollection(null)}
                onChooseFiles={openFiles}
                onChooseFolder={openFolder}
                onDeployedChange={setDeployed}
              />
              {!collection && !deployed && <AgentDeployCard />}
            </div>
          )}

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
        </>
      )}

      {/* 拖到页面任意位置即部署 —— 折叠时也生效 */}
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-tide-600 bg-tide-50/95 sm:inset-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-panel bg-tide-600 text-white shadow-lift">
            <UploadCloud className="h-7 w-7" />
          </span>
          <div className="text-[17px] font-bold text-tide-800">Release to deploy</div>
          <div className="text-[12.5px] text-tide-600">
            Drop anywhere — new site, or a new version of a matching slug
          </div>
        </div>
      )}
    </main>
  );
}
