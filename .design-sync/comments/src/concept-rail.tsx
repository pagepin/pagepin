/**
 * ConceptRail — "Margin": a persistent right-margin rail (Docs/Figma-style) where
 * every thread is a card vertically aligned to its anchor element, tied by an
 * on-demand hairline connector. The page keeps its natural width on the left and
 * is never covered; navigating threads is just reading down a column.
 *
 * Static first render: rail docked open, @page note pinned top, four anchored cards
 * sorted by page position, the style@#hero-cta card focused/expanded with an amber
 * accent stripe, full thread visible, a live connector arcing to the #hero-cta
 * button (which wears a matching amber 2px outline).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, CornerDownLeft, MessageSquarePlus, Plus, RotateCcw, StickyNote, X } from 'lucide-react';
import { ReviewPage } from './review-page';
import {
  KIND,
  KIND_KEYS,
  VIEWER,
  avatarColor,
  fmtTime,
  initialOf,
  useAnchorRects,
  useThreads,
  type PpThread,
} from './concept-kit';

const RAIL_W = 340;
const ANCHOR_IDS = ['#hero-title', '#hero-sub', '#hero-cta', '#feature-1', '#feature-2', '#feature-3', '#pricing'];
const READING_BAND = 0.36; // fraction of viewport height the focused anchor parks at

type Filter = 'all' | 'open' | 'resolved';

const accentOf = (t: PpThread) => (t.kind ? KIND[t.kind].color : '#6b7480');
const tintOf = (t: PpThread) => (t.kind ? KIND[t.kind].tint : '#f4f5f6');

export function ConceptRail() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const { threads, addReply, setKind, toggleResolve, create } = useThreads();

  // Static-rich default: the style@#hero-cta thread is focused on first paint.
  const [focusedId, setFocusedId] = useState<string>('th_cta_style');
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverEl, setHoverEl] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [replyText, setReplyText] = useState('');
  const [kindMenu, setKindMenu] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ selector: string; text: string; kind: PpThread['kind'] } | null>(null);
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const rects = useAnchorRects(scrollRef.current, ANCHOR_IDS);
  const [shellRect, setShellRect] = useState<DOMRect | null>(null);
  // tick forces card-Y recompute on scroll so connectors and lanes track anchors
  const [, force] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      if (shellRef.current) setShellRect(shellRef.current.getBoundingClientRect());
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        force((n) => n + 1);
      });
    };
    el.addEventListener('scroll', onScroll, true);
    const ticks = [80, 220, 460, 820].map((d) => setTimeout(() => force((n) => n + 1), d));
    return () => {
      el.removeEventListener('scroll', onScroll, true);
      ticks.forEach(clearTimeout);
    };
  }, []);

  // ----- thread ordering: @page pinned first, then by anchor vertical position -----
  const ordered = useMemo(() => {
    const yOf = (t: PpThread) => {
      if (t.selector === '@page') return -1e9;
      const r = rects[t.selector];
      return r ? r.top : 1e9;
    };
    return [...threads].sort((a, b) => yOf(a) - yOf(b));
  }, [threads, rects]);

  const visible = useMemo(
    () =>
      ordered.filter((t) =>
        filter === 'all' ? true : filter === 'open' ? !t.resolved : t.resolved,
      ),
    [ordered, filter],
  );

  const openCount = threads.filter((t) => !t.resolved).length;

  // ----- card lane: desired Y from anchor, then a top-to-bottom collision push -----
  const HEADER_H = 116; // rail header + @page sticky block
  const GAP = 12;
  const EXPANDED_H = 224;
  const CONDENSED_H = 78;
  const heightOf = (t: PpThread) =>
    t.selector === '@page' ? 0 : t.id === focusedId ? EXPANDED_H : t.resolved ? 44 : CONDENSED_H;

  const lanes = useMemo(() => {
    if (!shellRect) return {} as Record<string, number>;
    const out: Record<string, number> = {};
    let cursor = HEADER_H;
    for (const t of visible) {
      if (t.selector === '@page') continue;
      const r = rects[t.selector];
      const desired = r ? r.top - shellRect.top + 4 : cursor;
      const y = Math.max(cursor, desired);
      out[t.id] = y;
      cursor = y + heightOf(t) + GAP;
    }
    return out;
  }, [visible, rects, shellRect, focusedId]);

  // ----- navigation: jump page so an anchor parks in the reading band -----
  const jumpTo = (t: PpThread) => {
    setFocusedId(t.id);
    if (t.selector === '@page') {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const el = scrollRef.current?.querySelector(t.selector) as HTMLElement | null;
    const sc = scrollRef.current;
    if (el && sc) {
      const target = el.offsetTop - sc.clientHeight * READING_BAND + el.offsetHeight / 2;
      sc.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  };

  const step = (dir: 1 | -1) => {
    const list = visible;
    const i = list.findIndex((t) => t.id === focusedId);
    const ni = i < 0 ? 0 : Math.min(list.length - 1, Math.max(0, i + dir));
    if (list[ni]) jumpTo(list[ni]);
  };

  // ----- keyboard: j/k navigate (guarded against typing in fields) -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;
      if (e.key === 'j') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'k') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, focusedId]);

  const postReply = (id: string) => {
    const text = replyText.trim();
    if (!text) return;
    addReply(id, text);
    setReplyText('');
  };

  const commitComposer = () => {
    if (!composer) return;
    const text = composer.text.trim();
    if (!text) {
      setComposer(null);
      return;
    }
    const t = create(composer.selector, text, composer.kind);
    setComposer(null);
    setFocusedId(t.id);
  };

  const doResolve = (t: PpThread) => {
    toggleResolve(t.id);
    if (!t.resolved) setUndo({ id: t.id, label: 'Resolved' });
  };

  // anchor rect for a thread relative to the shell (viewport coords minus shell offset)
  const anchorBox = (sel: string) => {
    if (!shellRect) return null;
    const r = rects[sel];
    if (!r) return null;
    return {
      left: r.left - shellRect.left,
      top: r.top - shellRect.top,
      right: r.right - shellRect.left,
      bottom: r.bottom - shellRect.top,
      width: r.width,
      height: r.height,
    };
  };

  const railLeft = shellRect ? shellRect.width - RAIL_W : 0;

  // which connector to draw: focused card always; hovered card/element overrides
  const linkId = hoverId || hoverEl ? hoverId || threads.find((t) => t.selector === hoverEl)?.id || focusedId : focusedId;
  const linkThread = threads.find((t) => t.id === linkId) || null;

  // ----- connector path: from card left edge -> element right edge (calm bezier) -----
  const connector = (() => {
    if (collapsed || !linkThread || linkThread.selector === '@page') return null;
    if (filter === 'resolved' && !linkThread.resolved) return null;
    if (filter === 'open' && linkThread.resolved) return null;
    const box = anchorBox(linkThread.selector);
    const cardY = lanes[linkThread.id];
    if (!box || cardY == null) return null;
    const x1 = box.right + 6;
    const y1 = box.top + box.height / 2;
    const x2 = railLeft - 2;
    const cardH = heightOf(linkThread);
    const y2 = cardY + Math.min(28, cardH / 2);
    const midX = x1 + (x2 - x1) * 0.55;
    return {
      d: `M ${x1} ${y1} C ${midX} ${y1}, ${x1 + (x2 - x1) * 0.3} ${y2}, ${x2} ${y2}`,
      x1,
      y1,
      x2,
      y2,
      color: accentOf(linkThread),
    };
  })();

  // outline boxes for active element + composer target + hovered element
  const outlineFor: { sel: string; color: string; solid: boolean }[] = [];
  if (!collapsed) {
    if (linkThread && linkThread.selector !== '@page') outlineFor.push({ sel: linkThread.selector, color: accentOf(linkThread), solid: linkThread.id === focusedId });
    if (composer && composer.selector !== '@page')
      outlineFor.push({ sel: composer.selector, color: composer.kind ? KIND[composer.kind].color : '#14958a', solid: true });
  }

  return (
    <div ref={shellRef} className="relative flex h-screen overflow-hidden bg-ink-50 font-sans text-ink-800">
      <style>{`
        @keyframes pp-draw { from { stroke-dashoffset: var(--pp-len); } to { stroke-dashoffset: 0; } }
        .pp-connector { animation: pp-draw .26s cubic-bezier(.2,.8,.3,1) both; }
        @keyframes pp-card-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .pp-rail-scroll::-webkit-scrollbar { width: 8px; }
        .pp-rail-scroll::-webkit-scrollbar-thumb { background: #d7dadd; border-radius: 8px; }
        @media (prefers-reduced-motion: reduce) {
          .pp-connector { animation: none !important; }
          * { scroll-behavior: auto !important; }
        }
      `}</style>

      {/* LEFT: the page, width-reserved so its right edge stops before the rail */}
      <div ref={scrollRef} className="pp-rail-scroll relative flex-1 overflow-y-auto" style={{ marginRight: RAIL_W }}>
        {/* hover-to-comment guideline + '+' affordance over each anchorable element */}
        <HoverPlus
          scrollRef={scrollRef}
          shellRect={shellRect}
          rects={rects}
          ids={['#hero-title', '#hero-sub', '#hero-cta', '#feature-1', '#feature-2', '#feature-3', '#pricing']}
          onPick={(sel) => {
            setComposer({ selector: sel, text: '', kind: null });
            const t = threads.find((x) => x.selector === sel);
            if (t) setFocusedId(t.id);
          }}
          onHover={setHoverEl}
        />
        <ReviewPage />
      </div>

      {/* element outlines (kind-colored) painted over the staged elements */}
      {outlineFor.map((o, i) => {
        const box = anchorBox(o.sel);
        if (!box) return null;
        return (
          <div
            key={`${o.sel}-${i}`}
            className="pointer-events-none absolute z-20 rounded-field transition-all duration-150"
            style={{
              left: box.left - 4,
              top: box.top - 4,
              width: box.width + 8,
              height: box.height + 8,
              boxShadow: `0 0 0 2px ${o.color}`,
              background: o.solid ? `${o.color}10` : 'transparent',
            }}
          />
        );
      })}

      {/* SVG connector overlay — above page, below rail, never eats clicks */}
      <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full" style={{ overflow: 'visible' }}>
        {connector && (
          <g>
            <circle cx={connector.x1} cy={connector.y1} r={3.5} fill={connector.color} />
            <path
              key={`${linkId}-${connector.x1}-${connector.y1}`}
              className="pp-connector"
              d={connector.d}
              fill="none"
              stroke={connector.color}
              strokeWidth={1.5}
              strokeLinecap="round"
              style={{ ['--pp-len' as string]: 400 } as React.CSSProperties}
              strokeDasharray={400}
            />
            <circle cx={connector.x2} cy={connector.y2} r={3} fill="#fff" stroke={connector.color} strokeWidth={1.5} />
          </g>
        )}
      </svg>

      {/* collapsed tab */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="absolute right-0 top-1/2 z-40 flex -translate-y-1/2 items-center gap-1.5 rounded-l-panel border border-r-0 border-ink-200 bg-white px-2.5 py-3 text-xs font-semibold text-ink-600 shadow-lift transition-transform hover:-translate-x-0.5"
          style={{ writingMode: 'vertical-rl' }}
        >
          <MessageSquarePlus className="h-4 w-4 rotate-90" />
          {threads.length} threads
        </button>
      )}

      {/* RIGHT: the rail */}
      <div
        ref={railRef}
        className="pp-rail-scroll absolute right-0 top-0 z-40 flex h-full flex-col border-l border-ink-200 bg-ink-50/95 shadow-[-8px_0_24px_-18px_rgba(17,22,27,0.25)] backdrop-blur transition-transform duration-300"
        style={{ width: RAIL_W, transform: collapsed ? `translateX(${RAIL_W}px)` : 'none' }}
      >
        {/* header */}
        <div className="shrink-0 border-b border-ink-200 bg-white px-4 pb-3 pt-3.5">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold tracking-tight text-ink-900">Orbit landing</div>
              <div className="mt-0.5 text-[11px] text-ink-500">
                {threads.length} threads · {openCount} open
              </div>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse rail"
              className="grid h-7 w-7 place-items-center rounded-field text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* filter + add controls */}
          <div className="mt-3 flex items-center gap-1.5">
            <div className="flex rounded-field bg-ink-100 p-0.5 text-[11px] font-semibold">
              {(['all', 'open', 'resolved'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-[7px] px-2.5 py-1 capitalize transition ${
                    filter === f ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-700'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setComposer({ selector: '#hero-title', text: '', kind: null })}
                title="Add comment"
                className="grid h-7 w-7 place-items-center rounded-field border border-ink-200 bg-white text-tide-600 transition hover:border-tide-300 hover:bg-tide-50"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={() => setComposer({ selector: '@page', text: '', kind: null })}
                title="Note on whole page"
                className="grid h-7 w-7 place-items-center rounded-field border border-ink-200 bg-white text-ink-500 transition hover:border-ink-300 hover:text-ink-700"
              >
                <StickyNote className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* @page note — sticky at rail top */}
        <PageNote
          threads={visible}
          focusedId={focusedId}
          onFocus={(id) => {
            setFocusedId(id);
            scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          replyText={replyText}
          setReplyText={setReplyText}
          postReply={postReply}
          onHover={setHoverId}
        />

        {/* lane-positioned cards (absolute, tracking anchors) */}
        <div className="relative flex-1 overflow-y-auto pp-rail-scroll">
          {/* spacer to give scroll height equal to last card bottom */}
          <div
            style={{
              height:
                (Object.values(lanes).length ? Math.max(...Object.values(lanes)) : HEADER_H) + EXPANDED_H + 40,
            }}
          />
          {visible
            .filter((t) => t.selector !== '@page')
            .map((t) => {
              const y = lanes[t.id];
              if (y == null) return null;
              const focused = t.id === focusedId;
              return (
                <ThreadCard
                  key={t.id}
                  thread={t}
                  y={y - HEADER_H + 8}
                  focused={focused}
                  hovered={hoverId === t.id || hoverEl === t.selector}
                  onFocus={() => jumpTo(t)}
                  onHover={(h) => setHoverId(h ? t.id : null)}
                  replyText={replyText}
                  setReplyText={setReplyText}
                  postReply={() => postReply(t.id)}
                  onResolve={() => doResolve(t)}
                  kindMenuOpen={kindMenu === t.id}
                  toggleKindMenu={() => setKindMenu((k) => (k === t.id ? null : t.id))}
                  setKind={(k) => {
                    setKind(t.id, k);
                    setKindMenu(null);
                  }}
                />
              );
            })}
        </div>

        {/* undo affordance */}
        {undo && (
          <div className="absolute bottom-3 left-1/2 z-50 flex -translate-x-1/2 animate-[pp-card-in_.25s_ease] items-center gap-2 rounded-field bg-ink-900 px-3 py-2 text-[12px] font-medium text-white shadow-toast">
            <Check className="h-3.5 w-3.5 text-tide-300" />
            {undo.label}
            <button
              onClick={() => {
                toggleResolve(undo.id);
                setUndo(null);
              }}
              className="ml-1 flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-tide-300 transition hover:bg-white/10"
            >
              <RotateCcw className="h-3 w-3" /> Undo
            </button>
            <button onClick={() => setUndo(null)} className="text-ink-400 transition hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* composer card — opens anchored to its target, pinned center-right of rail */}
      {composer && (
        <Composer
          composer={composer}
          setComposer={setComposer}
          commit={commitComposer}
          railLeft={railLeft}
        />
      )}
    </div>
  );
}

/* ---------------------------------- @page note ---------------------------------- */
function PageNote(props: {
  threads: PpThread[];
  focusedId: string;
  onFocus: (id: string) => void;
  replyText: string;
  setReplyText: (s: string) => void;
  postReply: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const t = props.threads.find((x) => x.selector === '@page');
  if (!t) return null;
  const focused = t.id === props.focusedId;
  const c0 = t.comments[0];
  return (
    <div className="shrink-0 border-b border-ink-200 bg-ink-50 px-3 pb-3 pt-3">
      <div
        onMouseEnter={() => props.onHover(t.id)}
        onMouseLeave={() => props.onHover(null)}
        onClick={() => props.onFocus(t.id)}
        className={`cursor-pointer rounded-card border bg-white p-3 shadow-card transition ${
          focused ? 'border-ink-300 shadow-lift' : 'border-ink-200 hover:border-ink-300'
        }`}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-chip bg-ink-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Whole page
          </span>
          <span className="text-[11px] text-ink-400">{fmtTime(c0.created_at)}</span>
        </div>
        <div className="flex gap-2.5">
          <Avatar name={c0.author_name} />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-ink-800">{c0.author_name}</div>
            <p className="mt-0.5 text-[12.5px] leading-snug text-ink-700">{c0.text}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- thread card ---------------------------------- */
function ThreadCard(props: {
  thread: PpThread;
  y: number;
  focused: boolean;
  hovered: boolean;
  onFocus: () => void;
  onHover: (h: boolean) => void;
  replyText: string;
  setReplyText: (s: string) => void;
  postReply: () => void;
  onResolve: () => void;
  kindMenuOpen: boolean;
  toggleKindMenu: () => void;
  setKind: (k: PpThread['kind']) => void;
}) {
  const t = props.thread;
  const accent = accentOf(t);
  const label = t.kind ? KIND[t.kind].label : 'Note';
  const sel = t.selector;
  const last = t.comments[t.comments.length - 1];

  if (t.resolved && !props.focused) {
    return (
      <div
        className="absolute left-3 right-3 transition-[top] duration-300"
        style={{ top: props.y }}
        onMouseEnter={() => props.onHover(true)}
        onMouseLeave={() => props.onHover(false)}
      >
        <button
          onClick={props.onFocus}
          className="flex w-full items-center gap-2 rounded-field border border-ink-200 bg-ink-50 px-3 py-2.5 text-left transition hover:bg-white"
        >
          <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-ink-300 text-white">
            <Check className="h-2.5 w-2.5" />
          </span>
          <span className="truncate text-[12px] font-medium text-ink-400 line-through">{label} · {sel}</span>
          <span className="ml-auto text-[11px] text-ink-400">{t.comments.length}</span>
        </button>
      </div>
    );
  }

  if (!props.focused) {
    return (
      <div
        className="absolute left-3 right-3 transition-[top] duration-300"
        style={{ top: props.y }}
        onMouseEnter={() => props.onHover(true)}
        onMouseLeave={() => props.onHover(false)}
      >
        <button
          onClick={props.onFocus}
          className={`relative w-full overflow-hidden rounded-card border bg-white p-3 pl-3.5 text-left shadow-card transition ${
            props.hovered ? 'border-ink-300 shadow-lift' : 'border-ink-200'
          }`}
        >
          <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
          <div className="flex items-center gap-2">
            <span
              className="rounded-chip px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ background: KIND[t.kind!]?.tint ?? '#f4f5f6', color: accent }}
            >
              {label}
            </span>
            <span className="font-mono text-[10.5px] text-ink-400">{sel}</span>
            <span className="ml-auto text-[11px] text-ink-400">{t.comments.length}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Avatar name={last.author_name} size={20} />
            <p className="min-w-0 flex-1 truncate text-[12px] text-ink-600">{last.text}</p>
          </div>
        </button>
      </div>
    );
  }

  // focused / expanded
  return (
    <div
      className="absolute left-3 right-3 z-10 transition-[top] duration-300"
      style={{ top: props.y }}
      onMouseEnter={() => props.onHover(true)}
      onMouseLeave={() => props.onHover(false)}
    >
      <div className="relative overflow-hidden rounded-card border border-ink-300 bg-white shadow-lift">
        <span className="absolute inset-y-0 left-0 w-1.5 transition-colors duration-150" style={{ background: accent }} />
        {/* header */}
        <div className="flex items-center gap-2 border-b border-ink-100 px-3.5 py-2.5 pl-4">
          <div className="relative">
            <button
              onClick={props.toggleKindMenu}
              className="flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide transition hover:brightness-95"
              style={{ background: KIND[t.kind!]?.tint ?? '#f4f5f6', color: accent }}
            >
              {label}
              <ChevronRight className="h-2.5 w-2.5 rotate-90 opacity-60" />
            </button>
            {props.kindMenuOpen && (
              <div className="absolute left-0 top-7 z-50 w-32 animate-[pp-card-in_.16s_ease] rounded-field border border-ink-200 bg-white p-1 shadow-lift">
                {KIND_KEYS.map((k) => (
                  <button
                    key={k}
                    onClick={() => props.setKind(k)}
                    className="flex w-full items-center gap-2 rounded-chip px-2 py-1.5 text-[12px] font-medium text-ink-700 transition hover:bg-ink-50"
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND[k].color }} />
                    {KIND[k].label}
                    {t.kind === k && <Check className="ml-auto h-3 w-3 text-tide-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="font-mono text-[10.5px] text-ink-400">{sel}</span>
          <button
            onClick={props.onResolve}
            title="Resolve thread"
            className="ml-auto flex items-center gap-1 rounded-field border border-ink-200 px-1.5 py-1 text-[11px] font-semibold text-ink-500 transition hover:border-tide-300 hover:bg-tide-50 hover:text-tide-700"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* thread body */}
        <div className="max-h-44 space-y-3 overflow-y-auto px-3.5 py-3 pl-4 pp-rail-scroll">
          {t.comments.map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <Avatar name={c.author_name} />
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[12px] font-semibold text-ink-800">{c.author_name}</span>
                  <span className="text-[10.5px] text-ink-400">{fmtTime(c.created_at)}</span>
                </div>
                <p className="mt-0.5 text-[12.5px] leading-snug text-ink-700">{c.text}</p>
              </div>
            </div>
          ))}
        </div>

        {/* reply field */}
        <div className="border-t border-ink-100 p-2 pl-3">
          <div className="flex items-end gap-1.5">
            <textarea
              value={props.replyText}
              onChange={(e) => props.setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  props.postReply();
                }
              }}
              rows={1}
              placeholder="Reply…"
              className="max-h-20 min-h-[34px] flex-1 resize-none rounded-field border border-ink-200 bg-ink-50 px-2.5 py-1.5 text-[12.5px] text-ink-800 outline-none transition placeholder:text-ink-400 focus:border-tide-400 focus:bg-white"
            />
            <button
              onClick={props.postReply}
              disabled={!props.replyText.trim()}
              className="grid h-[34px] w-9 place-items-center rounded-field bg-tide-600 text-white transition hover:bg-tide-700 disabled:cursor-not-allowed disabled:bg-ink-200"
            >
              <CornerDownLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------- composer ----------------------------------- */
function Composer(props: {
  composer: { selector: string; text: string; kind: PpThread['kind'] };
  setComposer: (c: { selector: string; text: string; kind: PpThread['kind'] } | null) => void;
  commit: () => void;
  railLeft: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const c = props.composer;
  const accent = c.kind ? KIND[c.kind].color : '#14958a';
  return (
    <div
      className="absolute top-24 z-50 animate-[pp-card-in_.18s_ease] overflow-hidden rounded-card border border-ink-300 bg-white shadow-modal"
      style={{ left: props.railLeft + 14, width: RAIL_W - 28 }}
    >
      <span className="absolute inset-y-0 left-0 w-1.5 transition-colors duration-150" style={{ background: accent }} />
      <div className="flex items-center gap-2 border-b border-ink-100 px-3.5 py-2.5 pl-4">
        <MessageSquarePlus className="h-3.5 w-3.5 text-tide-600" />
        <span className="text-[12px] font-bold text-ink-900">New comment</span>
        <span className="ml-auto font-mono text-[10.5px] text-ink-400">{c.selector}</span>
      </div>
      <div className="p-3 pl-4">
        <textarea
          ref={ref}
          value={c.text}
          onChange={(e) => props.setComposer({ ...c, text: e.target.value })}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              props.commit();
            }
            if (e.key === 'Escape') props.setComposer(null);
          }}
          rows={3}
          placeholder="Leave a comment…"
          className="w-full resize-none rounded-field border border-ink-200 bg-ink-50 px-2.5 py-2 text-[12.5px] text-ink-800 outline-none transition placeholder:text-ink-400 focus:border-tide-400 focus:bg-white"
        />
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {KIND_KEYS.map((k) => {
            const on = c.kind === k;
            return (
              <button
                key={k}
                onClick={() => props.setComposer({ ...c, kind: on ? null : k })}
                className="flex items-center gap-1 rounded-chip border px-2 py-0.5 text-[11px] font-semibold transition"
                style={{
                  borderColor: on ? KIND[k].color : '#e7e9eb',
                  background: on ? KIND[k].tint : '#fff',
                  color: on ? KIND[k].ink : '#6b7480',
                }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: KIND[k].color }} />
                {KIND[k].label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            onClick={() => props.setComposer(null)}
            className="rounded-field px-3 py-1.5 text-[12px] font-semibold text-ink-500 transition hover:bg-ink-100"
          >
            Cancel
          </button>
          <button
            onClick={props.commit}
            disabled={!c.text.trim()}
            className="flex items-center gap-1.5 rounded-field bg-tide-600 px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-tide-700 disabled:cursor-not-allowed disabled:bg-ink-200"
          >
            Comment
            <kbd className="rounded-[5px] bg-white/20 px-1 text-[10px]">⌘↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- hover-to-comment + affordance --------------------------- */
function HoverPlus(props: {
  scrollRef: React.RefObject<HTMLDivElement>;
  shellRect: DOMRect | null;
  rects: Record<string, DOMRect>;
  ids: string[];
  onPick: (sel: string) => void;
  onHover: (sel: string | null) => void;
}) {
  const [hov, setHov] = useState<string | null>(null);
  if (!props.shellRect) return null;
  return (
    <>
      {props.ids.map((sel) => {
        const r = props.rects[sel];
        if (!r) return null;
        const left = r.left - props.shellRect!.left;
        const top = r.top - props.shellRect!.top;
        const active = hov === sel;
        return (
          <div key={sel}>
            {/* hover hit-zone over the element (only the right strip, so it never blocks the page) */}
            <div
              className="absolute z-10"
              style={{ left, top, width: r.width, height: r.height }}
              onMouseEnter={() => {
                setHov(sel);
                props.onHover(sel);
              }}
              onMouseLeave={() => {
                setHov((h) => (h === sel ? null : h));
                props.onHover(null);
              }}
            >
              {active && (
                <button
                  onClick={() => props.onPick(sel)}
                  title={`Comment on ${sel}`}
                  className="absolute -right-3 top-1/2 grid h-6 w-6 -translate-y-1/2 translate-x-full place-items-center rounded-full border border-tide-300 bg-white text-tide-600 shadow-lift transition hover:bg-tide-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
              {active && (
                <span
                  className="pointer-events-none absolute -right-3 top-0 h-full w-px translate-x-full bg-tide-300"
                  style={{ boxShadow: '0 0 0 0.5px rgba(20,149,138,0.25)' }}
                />
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ------------------------------------ avatar ------------------------------------ */
function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const mine = name === VIEWER.name;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
      style={{
        width: size,
        height: size,
        background: avatarColor(name),
        boxShadow: mine ? '0 0 0 2px #fff, 0 0 0 3px #14958a' : 'none',
      }}
    >
      {initialOf(name)}
    </span>
  );
}
