/**
 * ConceptAtlas — "Atlas" (slug: spatial)
 *
 * Review as a MAP, not a stack of popovers. A slim vertical minimap of the page is
 * pinned to the right edge with every comment shown as a spatial dot. Selecting any
 * pin (on the map or the page) runs ONE continuous camera flight: the live page
 * scrolls/scales so the anchored element lands in the left STAGE, a radial spotlight
 * dims the rest, and the thread docks open in the right GUTTER beside it — never on
 * top. A translucent viewport lens rides the minimap. The flight is the single
 * reusable, reversible primitive shared across read / create / traverse.
 *
 * STATIC-RICH DEFAULT: style@#hero-cta is pre-selected and flown into the stage in a
 * useLayoutEffect, so the spotlight, docked gutter card, minimap dots + lens, and the
 * SVG connector are already painted on first paint (never gated behind hover).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  CornerDownLeft,
  Layers,
  Link2,
  Map as MapIcon,
  Plus,
  Send,
  X,
} from 'lucide-react';
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

/** Anchorable element ids in document order (matches review-page.tsx). */
const SELECTORS = [
  '#hero-title',
  '#hero-sub',
  '#hero-cta',
  '#feature-1',
  '#feature-2',
  '#feature-3',
  '#pricing',
];

const STAGE_SCALE = 1.06;
/** Where, vertically (fraction of viewport), the staged element should park. */
const STAGE_SWEET = 0.4;

function kindColor(kind: PpThread['kind']): string {
  return kind ? KIND[kind].color : '#6b7480';
}
function kindTint(kind: PpThread['kind']): string {
  return kind ? KIND[kind].tint : '#f4f5f6';
}
function kindLabel(kind: PpThread['kind']): string {
  return kind ? KIND[kind].label : 'Note';
}

export function ConceptAtlas() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const { threads, addReply, setKind, toggleResolve, create } = useThreads();

  // ----- selection / view state -------------------------------------------
  const [selectedId, setSelectedId] = useState<string>('th_cta_style'); // style@#hero-cta
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [reply, setReply] = useState('');
  const [hoverId, setHoverId] = useState<string | null>(null);

  // create flow
  const [arming, setArming] = useState(false); // crosshair primed from the map "+"
  const [draftSel, setDraftSel] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftKind, setDraftKind] = useState<PpThread['kind']>('copy');

  // geometry
  const [scrollTop, setScrollTop] = useState(0);
  const [pageH, setPageH] = useState(1);
  const [viewH, setViewH] = useState(1);
  const rects = useAnchorRects(scrollRef.current, SELECTORS);

  // pre-transform anchor centers (px within the scroll content), captured raw so the
  // stage scale never drifts the flight math.
  const [rawTops, setRawTops] = useState<Record<string, number>>({});
  const [rawHeights, setRawHeights] = useState<Record<string, number>>({});

  const measureRaw = useCallback(() => {
    const sc = scrollRef.current;
    const stage = stageRef.current;
    if (!sc || !stage) return;
    // measure against the UN-transformed offset positions inside the stage
    const tops: Record<string, number> = {};
    const hs: Record<string, number> = {};
    for (const sel of SELECTORS) {
      const el = sc.querySelector(sel) as HTMLElement | null;
      if (!el) continue;
      // offsetTop chain up to the scroll container is transform-independent
      let y = 0;
      let n: HTMLElement | null = el;
      while (n && n !== sc) {
        y += n.offsetTop;
        n = n.offsetParent as HTMLElement | null;
      }
      // offsetTop reflects layout, not the visual scale transform — raw layout px,
      // so the flight math stays scale-independent (per the spec's scale-drift pitfall).
      tops[sel] = y;
      hs[sel] = el.offsetHeight;
    }
    setRawTops(tops);
    setRawHeights(hs);
    setPageH(sc.scrollHeight);
    setViewH(sc.clientHeight);
  }, []);

  // ----- the FLIGHT: scroll target element into the stage sweet spot ------
  const flyTo = useCallback(
    (sel: string | null) => {
      const sc = scrollRef.current;
      if (!sc || !sel || sel === '@page') return;
      const top = rawTops[sel];
      const h = rawHeights[sel] ?? 0;
      if (top == null) return;
      const center = top + h / 2;
      const target = Math.max(0, center - sc.clientHeight * STAGE_SWEET);
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      sc.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' });
    },
    [rawTops, rawHeights],
  );

  const selected = threads.find((t) => t.id === selectedId) ?? null;

  // ----- STATIC-RICH first paint: measure + fly to style@#hero-cta --------
  const didInit = useRef(false);
  useLayoutEffect(() => {
    measureRaw();
    setScrollTop(scrollRef.current?.scrollTop ?? 0);
    setViewH(scrollRef.current?.clientHeight ?? 1);
    setPageH(scrollRef.current?.scrollHeight ?? 1);
  }, [measureRaw]);

  useEffect(() => {
    // settle after fonts/layout, then perform the opening flight ONCE
    const ticks = [40, 160, 360, 700].map((d) =>
      setTimeout(() => {
        measureRaw();
        if (!didInit.current && rectsReady()) {
          didInit.current = true;
          flyTo('#hero-cta');
        }
      }, d),
    );
    return () => ticks.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function rectsReady() {
    const sc = scrollRef.current;
    return !!(sc && sc.querySelector('#hero-cta'));
  }

  // track scroll for the lens
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setScrollTop(sc.scrollTop);
        setPageH(sc.scrollHeight);
        setViewH(sc.clientHeight);
      });
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      measureRaw();
      setScrollTop(sc.scrollTop);
    });
    ro.observe(sc);
    return () => {
      sc.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [measureRaw]);

  // re-fly when selection changes (but skip the very first programmatic init)
  const prevSel = useRef(selectedId);
  useEffect(() => {
    if (prevSel.current === selectedId) return;
    prevSel.current = selectedId;
    if (selected && selected.selector !== '@page') flyTo(selected.selector);
  }, [selectedId, selected, flyTo]);

  // ----- document-ordered traversal --------------------------------------
  const visible = useMemo(
    () => threads.filter((t) => (filter === 'open' ? !t.resolved : true)),
    [threads, filter],
  );
  const ordered = useMemo(() => {
    const idx = (t: PpThread) => {
      if (t.selector === '@page') return -1;
      const i = SELECTORS.indexOf(t.selector);
      return i === -1 ? 999 : i;
    };
    return [...threads].sort((a, b) => idx(a) - idx(b));
  }, [threads]);

  const hop = useCallback(
    (dir: 1 | -1) => {
      const list = ordered.filter((t) => (filter === 'open' ? !t.resolved : true));
      if (!list.length) return;
      const cur = list.findIndex((t) => t.id === selectedId);
      const next = list[(cur + dir + list.length) % list.length];
      setSelectedId(next.id);
    },
    [ordered, filter, selectedId],
  );

  // keyboard: ↑/↓ or j/k traverse
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input') {
        if (e.key === 'Escape') (document.activeElement as HTMLElement).blur();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        hop(1);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        hop(-1);
      } else if (e.key === 'Escape') {
        setArming(false);
        setDraftSel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hop]);

  // ----- stage flight transform (visual only; measured raw separately) ----
  // Park the selected element near STAGE_SWEET; scale gently. Because we drive scroll
  // to put the element in place, the transform here is a subtle scale + small lift
  // that reads as a "camera" without breaking layout math.
  const flight = useMemo(() => {
    if (!selected || selected.selector === '@page') {
      return { transform: 'none', originY: 50 };
    }
    const top = rawTops[selected.selector];
    const h = rawHeights[selected.selector] ?? 0;
    if (top == null) return { transform: 'none', originY: 50 };
    const center = top + h / 2;
    const originY = pageH > 0 ? (center / pageH) * 100 : 50;
    return {
      transform: `scale(${STAGE_SCALE})`,
      originY,
    };
  }, [selected, rawTops, rawHeights, pageH]);

  // ----- spotlight center (viewport coords of the selected element) -------
  const spotRect = selected && selected.selector !== '@page' ? rects[selected.selector] : null;

  // ----- minimap geometry -------------------------------------------------
  const MAP_PAD = 14;
  const [mapBox, setMapBox] = useState({ h: 600 });
  const mapTrackRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = mapTrackRef.current;
    if (el) setMapBox({ h: el.clientHeight });
    const ro = new ResizeObserver(() => {
      if (mapTrackRef.current) setMapBox({ h: mapTrackRef.current.clientHeight });
    });
    if (el) ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mapY = useCallback(
    (sel: string) => {
      if (sel === '@page') return 6;
      const top = rawTops[sel];
      if (top == null || pageH <= 0) return 6;
      const h = rawHeights[sel] ?? 0;
      const center = top + h / 2;
      return MAP_PAD + (center / pageH) * (mapBox.h - MAP_PAD * 2);
    },
    [rawTops, rawHeights, pageH, mapBox.h],
  );

  const lens = useMemo(() => {
    if (pageH <= 0) return { top: 0, h: 0 };
    const usable = mapBox.h - MAP_PAD * 2;
    return {
      top: MAP_PAD + (scrollTop / pageH) * usable,
      h: Math.max(18, (viewH / pageH) * usable),
    };
  }, [scrollTop, pageH, viewH, mapBox.h]);

  // drag the lens to scroll the page live
  const draggingLens = useRef(false);
  const onLensDown = (e: React.PointerEvent) => {
    draggingLens.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onLensMove = (e: React.PointerEvent) => {
    if (!draggingLens.current) return;
    const track = mapTrackRef.current;
    const sc = scrollRef.current;
    if (!track || !sc) return;
    const r = track.getBoundingClientRect();
    const usable = mapBox.h - MAP_PAD * 2;
    const frac = Math.min(1, Math.max(0, (e.clientY - r.top - MAP_PAD) / usable));
    sc.scrollTo({ top: frac * (pageH - viewH), behavior: 'auto' });
  };
  const onLensUp = (e: React.PointerEvent) => {
    draggingLens.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  // ----- create flow ------------------------------------------------------
  const onStageElementClick = (sel: string) => {
    if (!arming) return;
    setArming(false);
    setDraftSel(sel);
    setDraftText('');
    setDraftKind('copy');
    flyTo(sel);
  };
  const commitDraft = () => {
    if (!draftSel || !draftText.trim()) return;
    const t = create(draftSel, draftText.trim(), draftKind);
    setDraftSel(null);
    setDraftText('');
    setSelectedId(t.id);
  };

  const postReply = () => {
    if (!selected || !reply.trim()) return;
    addReply(selected.id, reply.trim());
    setReply('');
  };

  const openCount = threads.filter((t) => !t.resolved).length;

  // ----- connector path: gutter card -> minimap dot -----------------------
  const cardEdgeRef = useRef<HTMLDivElement>(null);
  const [conn, setConn] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const recomputeConn = useCallback(() => {
    const shell = shellRef.current;
    const edge = cardEdgeRef.current;
    const track = mapTrackRef.current;
    if (!shell || !edge || !track || !selected) return setConn(null);
    const sb = shell.getBoundingClientRect();
    const eb = edge.getBoundingClientRect();
    const tb = track.getBoundingClientRect();
    setConn({
      x1: eb.right - sb.left,
      y1: eb.top + eb.height / 2 - sb.top,
      x2: tb.left + tb.width / 2 - sb.left,
      y2: tb.top + mapY(selected.selector) - sb.top,
    });
  }, [selected, mapY]);
  useLayoutEffect(() => {
    recomputeConn();
  }, [recomputeConn, scrollTop, mapBox.h, selectedId, filter, draftSel, reply]);
  useEffect(() => {
    const id = setTimeout(recomputeConn, 120);
    window.addEventListener('resize', recomputeConn);
    return () => {
      clearTimeout(id);
      window.removeEventListener('resize', recomputeConn);
    };
  }, [recomputeConn]);

  // =======================================================================
  return (
    <div
      ref={shellRef}
      className="relative flex h-screen overflow-hidden bg-ink-50 font-sans text-ink-800"
    >
      <style>{keyframes}</style>

      {/* ====================== LEFT: STAGE (the page) ====================== */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          className="relative h-full overflow-y-auto"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div
            ref={stageRef}
            className="origin-top transition-transform duration-[360ms] ease-[cubic-bezier(.2,.8,.2,1)]"
            style={{
              transform: flight.transform,
              transformOrigin: `50% ${flight.originY}%`,
            }}
          >
            <ReviewPage />
          </div>
        </div>

        {/* radial spotlight scrim — dims everything outside the staged element */}
        <SpotlightScrim rect={spotRect} active={!!spotRect && !draftSel} />

        {/* on-page pins + hover "+ comment" tabs (live, viewport coords) */}
        <PageOverlay
          rects={rects}
          threads={threads}
          filter={filter}
          selectedId={selectedId}
          hoverId={hoverId}
          arming={arming}
          draftSel={draftSel}
          onSelect={setSelectedId}
          onHover={setHoverId}
          onCreateAt={(sel) => {
            setArming(false);
            setDraftSel(sel);
            setDraftText('');
            setDraftKind('copy');
            flyTo(sel);
          }}
          onArmedClick={onStageElementClick}
        />

        {/* arming hint */}
        {arming && (
          <div className="pointer-events-none absolute left-1/2 top-5 z-40 -translate-x-1/2 animate-[atlasFade_.2s_ease] rounded-field bg-ink-900/92 px-3.5 py-2 text-xs font-medium text-white shadow-lift">
            Click an element to drop a comment · Esc to cancel
          </div>
        )}
      </div>

      {/* ====================== CENTER-RIGHT: GUTTER ====================== */}
      <div className="relative z-30 flex w-[372px] shrink-0 flex-col border-l border-ink-200 bg-white/0">
        <GutterPanel
          edgeRef={cardEdgeRef}
          selected={selected}
          draftSel={draftSel}
          draftText={draftText}
          draftKind={draftKind}
          reply={reply}
          onReply={setReply}
          onPostReply={postReply}
          onSetKind={(k) => selected && setKind(selected.id, k)}
          onResolve={() => selected && toggleResolve(selected.id)}
          onClose={() => setSelectedId('')}
          onHop={hop}
          onDraftText={setDraftText}
          onDraftKind={setDraftKind}
          onCommitDraft={commitDraft}
          onCancelDraft={() => setDraftSel(null)}
        />
      </div>

      {/* ====================== FAR-RIGHT: ATLAS minimap ====================== */}
      <aside className="relative z-30 flex w-[112px] shrink-0 flex-col border-l border-ink-200 bg-ink-50/80 backdrop-blur-sm">
        {/* header: title + Open/All + add */}
        <div className="flex flex-col gap-2 border-b border-ink-200 px-2.5 py-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-600">
            <MapIcon className="h-3.5 w-3.5 text-tide-600" />
            Atlas
          </div>
          <div className="flex overflow-hidden rounded-chip border border-ink-200 bg-white text-[10px] font-semibold">
            {(['open', 'all'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 px-1.5 py-1 capitalize transition-colors ${
                  filter === f ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-ink-100'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setArming((a) => !a);
              setDraftSel(null);
            }}
            className={`flex items-center justify-center gap-1 rounded-chip border px-1.5 py-1 text-[10px] font-semibold transition-colors ${
              arming
                ? 'border-tide-500 bg-tide-50 text-tide-700'
                : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-100'
            }`}
          >
            <Plus className="h-3 w-3" /> {arming ? 'Aim…' : 'Pin'}
          </button>
        </div>

        {/* the minimap track */}
        <div className="relative flex-1 px-2.5 py-2">
          <div
            ref={mapTrackRef}
            className="relative h-full w-full overflow-hidden rounded-panel border border-ink-200 bg-white"
          >
            {/* schematic page silhouette */}
            <MinimapSilhouette />

            {/* viewport lens */}
            <div
              onPointerDown={onLensDown}
              onPointerMove={onLensMove}
              onPointerUp={onLensUp}
              className="absolute inset-x-1 cursor-grab touch-none rounded-[5px] border border-tide-500/70 bg-tide-400/15 transition-[top] duration-150 active:cursor-grabbing"
              style={{ top: lens.top, height: lens.h }}
            >
              <div className="absolute -left-[1px] top-1/2 h-3 w-[3px] -translate-y-1/2 rounded-full bg-tide-500/80" />
            </div>

            {/* @page chip at the very top */}
            {threads
              .filter((t) => t.selector === '@page')
              .map((t) => {
                const sel = t.id === selectedId;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    title="Whole-page note"
                    className="absolute left-1/2 -translate-x-1/2"
                    style={{ top: 4 }}
                  >
                    <span
                      className={`flex h-[18px] items-center justify-center rounded-chip border px-1.5 text-[10px] font-bold leading-none transition-all ${
                        sel
                          ? 'border-ink-800 bg-ink-900 text-white'
                          : 'border-ink-300 bg-white text-ink-600'
                      }`}
                    >
                      ¶
                    </span>
                  </button>
                );
              })}

            {/* anchored dots */}
            {threads
              .filter((t) => t.selector !== '@page')
              .filter((t) => (filter === 'open' ? !t.resolved : true))
              .map((t) => {
                const c = t.resolved ? '#9aa1a9' : kindColor(t.kind);
                const sel = t.id === selectedId;
                const hov = t.id === hoverId;
                const multi = t.comments.length > 1;
                const y = mapY(t.selector);
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    onMouseEnter={() => setHoverId(t.id)}
                    onMouseLeave={() => setHoverId(null)}
                    className="group absolute left-1/2 -translate-x-1/2"
                    style={{ top: y }}
                  >
                    {sel && (
                      <span
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-[atlasPing_1.8s_ease-in-out_infinite] rounded-full"
                        style={{
                          width: 22,
                          height: 22,
                          boxShadow: `0 0 0 2px ${c}55`,
                        }}
                      />
                    )}
                    <span
                      className="block -translate-y-1/2 rounded-full border-2 border-white transition-all"
                      style={{
                        width: multi ? 13 : 10,
                        height: multi ? 13 : 10,
                        background: c,
                        boxShadow: sel
                          ? `0 0 0 3px ${c}33, 0 1px 3px rgba(0,0,0,.25)`
                          : hov
                          ? `0 0 0 3px ${c}22`
                          : '0 1px 2px rgba(0,0,0,.18)',
                        transform: `translateY(-50%) scale(${sel ? 1.15 : 1})`,
                        opacity: t.resolved ? 0.6 : 1,
                      }}
                    />
                  </button>
                );
              })}
          </div>

          {/* legend */}
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 px-0.5">
            {KIND_KEYS.map((k) => (
              <span key={k} className="flex items-center gap-1 text-[9px] text-ink-500">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: KIND[k].color }}
                />
                {KIND[k].label}
              </span>
            ))}
          </div>
        </div>

        {/* overview hint */}
        <div className="flex items-center justify-center gap-1 border-t border-ink-200 px-2 py-2 text-[9px] font-medium text-ink-400">
          <Layers className="h-3 w-3" />
          {threads.length} pins · {openCount} open
        </div>
      </aside>

      {/* ====================== SVG CONNECTOR OVERLAY ====================== */}
      <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full">
        {conn && selected && (
          <ConnectorPath
            x1={conn.x1}
            y1={conn.y1}
            x2={conn.x2}
            y2={conn.y2}
            color={selected.resolved ? '#9aa1a9' : kindColor(selected.kind)}
          />
        )}
      </svg>
    </div>
  );
}

/* ========================================================================= */
/* Spotlight scrim — radial dim everything outside the staged element rect.  */
/* ========================================================================= */
function SpotlightScrim({ rect, active }: { rect: DOMRect | null; active: boolean }) {
  if (!rect || !active) {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-300"
        style={{ opacity: 0 }}
      />
    );
  }
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const r = Math.max(rect.width, rect.height) * 0.62 + 70;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 transition-all duration-[360ms] ease-[cubic-bezier(.2,.8,.2,1)]"
      style={{
        background: `radial-gradient(circle ${r}px at ${cx}px ${cy}px, rgba(17,22,27,0) 60%, rgba(17,22,27,0.12) 86%, rgba(17,22,27,0.30) 100%)`,
      }}
    >
      {/* crisp focus ring on the staged element */}
      <div
        className="absolute rounded-field transition-all duration-[360ms] ease-[cubic-bezier(.2,.8,.2,1)]"
        style={{
          left: rect.left - 6,
          top: rect.top - 6,
          width: rect.width + 12,
          height: rect.height + 12,
        }}
      />
    </div>
  );
}

/* ========================================================================= */
/* Page overlay — pins + hover "+ comment" tabs, in viewport coords.         */
/* ========================================================================= */
function PageOverlay({
  rects,
  threads,
  filter,
  selectedId,
  hoverId,
  arming,
  draftSel,
  onSelect,
  onHover,
  onCreateAt,
  onArmedClick,
}: {
  rects: Record<string, DOMRect>;
  threads: PpThread[];
  filter: 'open' | 'all';
  selectedId: string;
  hoverId: string | null;
  arming: boolean;
  draftSel: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onCreateAt: (sel: string) => void;
  onArmedClick: (sel: string) => void;
}) {
  const [hoverEl, setHoverEl] = useState<string | null>(null);

  const bySel = useMemo(() => {
    const m: Record<string, PpThread> = {};
    for (const t of threads) if (t.selector !== '@page') m[t.selector] = t;
    return m;
  }, [threads]);

  return (
    <div className="pointer-events-none absolute inset-0 z-[15]">
      {SELECTORS.map((sel) => {
        const r = rects[sel];
        if (!r) return null;
        const t = bySel[sel];
        const shown = t && (filter === 'open' ? !t.resolved : true);
        const isSel = t && t.id === selectedId;
        const isHover = (t && t.id === hoverId) || hoverEl === sel;
        const isDraft = draftSel === sel;
        const color = t ? (t.resolved ? '#9aa1a9' : kindColor(t.kind)) : '#14958a';

        return (
          <div key={sel}>
            {/* clickable hit zone over the element (only when interactive) */}
            <div
              className="pointer-events-auto absolute"
              style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
              onMouseEnter={() => setHoverEl(sel)}
              onMouseLeave={() => setHoverEl(null)}
              onClick={() => {
                if (arming) onArmedClick(sel);
                else if (t) onSelect(t.id);
              }}
            >
              {/* hover outline / draft outline */}
              {(isHover || isDraft || isSel) && (
                <div
                  className="pointer-events-none absolute -inset-1 rounded-field transition-all duration-200"
                  style={{
                    boxShadow: isSel || isDraft
                      ? `0 0 0 2px ${isDraft ? '#14958a' : color}`
                      : `0 0 0 1.5px ${arming ? '#14958a' : color}99`,
                  }}
                />
              )}

              {/* "+ comment" tab on hover (when not selected/armed) */}
              {isHover && !t && !arming && (
                <button
                  className="pointer-events-auto absolute -right-1 -top-2 flex items-center gap-1 rounded-chip bg-tide-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow-lift transition-transform hover:scale-105"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateAt(sel);
                  }}
                >
                  <Plus className="h-2.5 w-2.5" /> comment
                </button>
              )}
            </div>

            {/* numbered pin badge at the element's top-right */}
            {shown && t && (
              <button
                className="pointer-events-auto absolute z-10 flex -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border-2 border-white font-bold text-white transition-all"
                style={{
                  left: r.right,
                  top: r.top + 8,
                  width: isSel ? 22 : 18,
                  height: isSel ? 22 : 18,
                  fontSize: isSel ? 11 : 10,
                  background: color,
                  boxShadow: isSel
                    ? `0 0 0 3px ${color}33, 0 2px 6px rgba(0,0,0,.28)`
                    : '0 1px 3px rgba(0,0,0,.22)',
                  opacity: t.resolved ? 0.7 : 1,
                }}
                onMouseEnter={() => onHover(t.id)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onSelect(t.id)}
              >
                {t.resolved ? <Check className="h-3 w-3" /> : t.comments.length}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ========================================================================= */
/* Connector path — gutter card edge -> minimap dot, a calm horizontal bezier */
/* ========================================================================= */
function ConnectorPath({
  x1,
  y1,
  x2,
  y2,
  color,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}) {
  const midX = x1 + (x2 - x1) * 0.55;
  const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeOpacity={0.85}
        strokeLinecap="round"
        style={{
          strokeDasharray: 520,
          strokeDashoffset: 0,
          animation: 'atlasDraw .5s cubic-bezier(.2,.8,.2,1) both',
        }}
      />
      <circle cx={x1} cy={y1} r={3} fill={color} />
      <circle cx={x2} cy={y2} r={3} fill="#fff" stroke={color} strokeWidth={1.5} />
    </g>
  );
}

/* ========================================================================= */
/* Gutter panel — docked thread OR composer, beside the staged element.      */
/* ========================================================================= */
function GutterPanel({
  edgeRef,
  selected,
  draftSel,
  draftText,
  draftKind,
  reply,
  onReply,
  onPostReply,
  onSetKind,
  onResolve,
  onClose,
  onHop,
  onDraftText,
  onDraftKind,
  onCommitDraft,
  onCancelDraft,
}: {
  edgeRef: React.RefObject<HTMLDivElement>;
  selected: PpThread | null;
  draftSel: string | null;
  draftText: string;
  draftKind: PpThread['kind'];
  reply: string;
  onReply: (s: string) => void;
  onPostReply: () => void;
  onSetKind: (k: PpThread['kind']) => void;
  onResolve: () => void;
  onClose: () => void;
  onHop: (d: 1 | -1) => void;
  onDraftText: (s: string) => void;
  onDraftKind: (k: PpThread['kind']) => void;
  onCommitDraft: () => void;
  onCancelDraft: () => void;
}) {
  // ----- composer (create) takes precedence ------
  if (draftSel) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-ink-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-600">
            <Plus className="h-3.5 w-3.5 text-tide-600" /> New comment
          </div>
          <button onClick={onCancelDraft} className="rounded p-1 text-ink-400 hover:bg-ink-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-white px-4 py-4">
          <div
            ref={edgeRef}
            className="rounded-card border border-ink-200 bg-white p-3.5 shadow-card animate-[atlasIn_.3s_cubic-bezier(.2,.8,.2,1)_both]"
          >
            <span className="inline-flex items-center gap-1 rounded-chip bg-ink-100 px-2 py-0.5 font-mono text-[11px] text-ink-600">
              <Link2 className="h-3 w-3" /> {draftSel}
            </span>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {KIND_KEYS.map((k) => {
                const on = draftKind === k;
                return (
                  <button
                    key={k}
                    onClick={() => onDraftKind(k)}
                    className="rounded-chip border px-2 py-1 text-[11px] font-semibold transition-all"
                    style={{
                      borderColor: on ? KIND[k].color : '#e7e9eb',
                      background: on ? KIND[k].tint : '#fff',
                      color: on ? KIND[k].ink : '#6b7480',
                    }}
                  >
                    {KIND[k].label}
                  </button>
                );
              })}
            </div>
            <textarea
              autoFocus
              value={draftText}
              onChange={(e) => onDraftText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onCommitDraft();
              }}
              placeholder="Leave a comment on this element…"
              className="mt-3 h-24 w-full resize-none rounded-field border border-ink-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-ink-800 outline-none placeholder:text-ink-400 focus:border-tide-400"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                onClick={onCancelDraft}
                className="rounded-field px-3 py-1.5 text-xs font-semibold text-ink-500 hover:bg-ink-100"
              >
                Cancel
              </button>
              <button
                onClick={onCommitDraft}
                disabled={!draftText.trim()}
                className="flex items-center gap-1.5 rounded-field bg-tide-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-card transition-opacity disabled:opacity-40"
              >
                Comment
                <span className="flex items-center gap-0.5 text-[10px] opacity-70">
                  <span className="rounded bg-white/20 px-1">⌘</span>
                  <CornerDownLeft className="h-2.5 w-2.5" />
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----- empty state ------
  if (!selected) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-white px-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-panel bg-tide-50 text-tide-600">
          <MapIcon className="h-6 w-6" />
        </div>
        <p className="mt-4 text-sm font-semibold text-ink-700">Nothing selected</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-400">
          Tap a pin on the page or the Atlas map to fly to a thread.
        </p>
        <div className="mt-4 flex items-center gap-1 rounded-chip bg-ink-100 px-2.5 py-1 text-[11px] text-ink-500">
          <ArrowUp className="h-3 w-3" /> <ArrowDown className="h-3 w-3" /> to traverse
        </div>
      </div>
    );
  }

  // ----- docked thread ------
  const t = selected;
  const isPage = t.selector === '@page';
  const color = t.resolved ? '#9aa1a9' : kindColor(t.kind);

  return (
    <div className="flex h-full flex-col bg-white">
      {/* header */}
      <div className="border-b border-ink-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="rounded-chip px-2 py-0.5 text-[11px] font-bold"
              style={{
                background: t.resolved ? '#f4f5f6' : kindTint(t.kind),
                color: t.resolved ? '#6b7480' : t.kind ? KIND[t.kind].ink : '#6b7480',
              }}
            >
              {t.resolved ? 'Resolved' : kindLabel(t.kind)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-chip bg-ink-100 px-2 py-0.5 font-mono text-[11px] text-ink-600">
              {isPage ? '¶ @page' : t.selector}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => onHop(-1)}
              title="Previous thread (↑)"
              className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              onClick={() => onHop(1)}
              title="Next thread (↓)"
              className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* re-tag chips + resolve */}
        {!isPage && (
          <div className="mt-2.5 flex items-center justify-between">
            <div className="flex flex-wrap gap-1">
              {KIND_KEYS.map((k) => {
                const on = t.kind === k && !t.resolved;
                return (
                  <button
                    key={k}
                    onClick={() => onSetKind(k)}
                    className="rounded-chip border px-1.5 py-0.5 text-[10px] font-semibold transition-all"
                    style={{
                      borderColor: on ? KIND[k].color : '#e7e9eb',
                      background: on ? KIND[k].tint : '#fff',
                      color: on ? KIND[k].ink : '#9aa1a9',
                    }}
                  >
                    {KIND[k].label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={onResolve}
              className="flex items-center gap-1 rounded-chip border px-2 py-0.5 text-[10px] font-semibold transition-colors"
              style={
                t.resolved
                  ? { borderColor: '#bfe5df', background: '#e6f4f2', color: '#0b6358' }
                  : { borderColor: '#e7e9eb', background: '#fff', color: '#6b7480' }
              }
            >
              <Check className="h-3 w-3" /> {t.resolved ? 'Resolved' : 'Resolve'}
            </button>
          </div>
        )}
      </div>

      {/* the docked card — its left edge anchors the connector */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div
          ref={edgeRef}
          className="relative overflow-hidden rounded-card border border-ink-200 bg-white shadow-card animate-[atlasIn_.32s_cubic-bezier(.2,.8,.2,1)_both]"
        >
          {/* kind accent stripe */}
          <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
          <div className="space-y-0 pl-3">
            {t.comments.map((c, i) => (
              <div
                key={c.id}
                className={`px-3 py-3 ${i > 0 ? 'border-t border-ink-100' : ''} ${
                  i === t.comments.length - 1 && i > 0 ? 'animate-[atlasFade_.3s_ease]' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: avatarColor(c.author_name) }}
                  >
                    {initialOf(c.author_name)}
                  </span>
                  <span className="text-[13px] font-semibold text-ink-800">{c.author_name}</span>
                  {c.author_sub === VIEWER.sub && (
                    <span className="rounded-chip bg-tide-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-tide-700">
                      you
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-ink-400">{fmtTime(c.created_at)}</span>
                </div>
                <p className="mt-1.5 pl-8 text-[13px] leading-relaxed text-ink-700">{c.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* reply field */}
      <div className="border-t border-ink-200 bg-ink-50/60 px-4 py-3">
        <div className="flex items-end gap-2 rounded-field border border-ink-200 bg-white px-2.5 py-1.5 focus-within:border-tide-400">
          <textarea
            value={reply}
            onChange={(e) => onReply(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onPostReply();
            }}
            rows={1}
            placeholder="Reply…"
            className="max-h-24 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed text-ink-800 outline-none placeholder:text-ink-400"
          />
          <button
            onClick={onPostReply}
            disabled={!reply.trim()}
            className="mb-0.5 flex h-7 w-7 items-center justify-center rounded-field bg-tide-600 text-white transition-opacity disabled:opacity-30"
            title="Reply (⌘↵)"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-1 px-0.5 text-[10px] text-ink-400">
          <ChevronRight className="h-3 w-3" /> ⌘↵ to send · ↑/↓ to fly between threads
        </div>
      </div>
    </div>
  );
}

/* ========================================================================= */
/* Minimap schematic — a thin page silhouette behind the dots.               */
/* ========================================================================= */
function MinimapSilhouette() {
  return (
    <div className="absolute inset-0 opacity-100">
      {/* header bar */}
      <div className="absolute left-2 right-2 top-2 h-[6px] rounded-[2px] bg-ink-100" />
      {/* hero block */}
      <div className="absolute left-3 right-3 top-[16px] h-[7px] rounded-[2px] bg-ink-200/80" />
      <div className="absolute left-4 right-4 top-[26px] h-[4px] rounded-[2px] bg-ink-100" />
      <div className="absolute left-1/2 top-[34px] h-[6px] w-7 -translate-x-1/2 rounded-[2px] bg-tide-200/70" />
      {/* stats strip */}
      <div className="absolute left-2 right-2 top-[48px] h-[10px] rounded-[2px] bg-ink-100/70" />
      {/* feature cards */}
      <div className="absolute left-2 top-[66px] flex w-full gap-1 pr-4">
        <div className="h-[18px] w-1/3 rounded-[3px] border border-ink-200 bg-white" />
        <div className="h-[18px] w-1/3 rounded-[3px] border border-ink-200 bg-white" />
        <div className="h-[18px] w-1/3 rounded-[3px] border border-ink-200 bg-white" />
      </div>
      {/* pricing band */}
      <div className="absolute bottom-[26px] left-3 right-3 h-[20px] rounded-[3px] border border-tide-200/70 bg-tide-50/60" />
      {/* footer */}
      <div className="absolute bottom-[10px] left-3 right-3 h-[4px] rounded-[2px] bg-ink-100" />
    </div>
  );
}

/* keyframes injected once */
const keyframes = `
@keyframes atlasDraw { from { stroke-dashoffset: 520; } to { stroke-dashoffset: 0; } }
@keyframes atlasIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
@keyframes atlasFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes atlasPing {
  0%, 100% { opacity: .35; transform: translate(-50%,-50%) scale(.85); }
  50% { opacity: .9; transform: translate(-50%,-50%) scale(1.15); }
}
@media (prefers-reduced-motion: reduce) {
  .animate-\\[atlasIn_\\.32s_cubic-bezier\\(\\.2\\,\\.8\\,\\.2\\,1\\)_both\\],
  .animate-\\[atlasIn_\\.3s_cubic-bezier\\(\\.2\\,\\.8\\,\\.2\\,1\\)_both\\] { animation: none !important; }
}
`;
