/**
 * ConceptKeyboardV2 — "Keyboard, refined" (slug: keyboard-v2)
 *
 * The v1 keyboard cockpit, fixed where the walkthrough found friction:
 *
 *  1. NO PAGE SQUEEZE. The page fills the whole viewport (absolute inset-0); the
 *     review rail is a FLOATING DRAWER over the right edge, not a flex sibling that
 *     reserves width. The hosted page renders at its true width with zero reflow —
 *     critical for a review tool whose job is "what the reviewer sees == what
 *     visitors see". Collapse it (\\ or the tab) and even the right strip is back.
 *  2. MOUSE-FIRST CREATION. Hovering any anchorable element shows a "+ comment"
 *     affordance — a casual reviewer never needs to know the c-then-click mode.
 *     Pins are clickable to select. The keyboard grammar stays as an accelerator.
 *  3. CLEAR RESOLVED STATE. A focused resolved thread reads as resolved (header
 *     strip + Reopen), never identical to an open one.
 *  4. JUST ENOUGH (positioning locked to "fast pinpoint review, no burden"): no command
 *     palette, no taught keyboard grammar beyond j/k · r · c · \\, no resolve ceremony.
 *     The only loud surfaces are pins, the glow camera, and one in-context "+ comment";
 *     element comments come from the hover pill, the one header button is just the
 *     whole-page note. Management (priority / sign-off / assignment) lives in the console.
 *
 * Static first render: focus = copy@#hero-title (blue glow-ring pre-measured),
 * drawer open with the stacked thread list.
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
  ArrowRight,
  Check,
  CornerDownLeft,
  Plus,
  RotateCcw,
  Reply,
  Command as CommandIcon,
  CheckCheck,
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

const SELECTORS = ['#hero-title', '#hero-sub', '#hero-cta', '#feature-1', '#feature-2', '#feature-3', '#pricing'];
const EASE = 'cubic-bezier(.2,.8,.3,1)';
const DRAWER_W = 320;

// Width-aware auto-collapse. The floating drawer's content occlusion is width-dependent
// (measured: 96px@1280, 53px@1366, 16px@1440 [feathered away], 0px@≥1536). So below the
// point where the feather stops covering it, retract the drawer to its spine on its own —
// the reviewer gets the true page back without having to press \\. Hysteresis bands (≤1366
// narrow, ≥1536 wide, 1367–1535 keep-as-is) stop it flapping mid-resize, and a manual toggle
// always wins until the next boundary crossing.
const NARROW_MAX = 1366;
const WIDE_MIN = 1536;
const widthBucket = (w: number): 'narrow' | 'mid' | 'wide' =>
  w <= NARROW_MAX ? 'narrow' : w >= WIDE_MIN ? 'wide' : 'mid';
const initialRailOpen = () => (typeof window === 'undefined' ? true : window.innerWidth > NARROW_MAX);

const anchorLabel = (sel: string) => (sel === '@page' ? 'Whole page' : sel.replace(/^#/, ''));
const accentOf = (k: PpThread['kind']) => (k ? KIND[k].color : '#6b7480');

/** Document order for j/k traversal; @page pinned last. */
function docOrder(threads: PpThread[]): PpThread[] {
  const rank = (sel: string) => {
    const i = SELECTORS.indexOf(sel);
    return i === -1 ? SELECTORS.length + 1 : i;
  };
  return [...threads].sort((a, b) => rank(a.selector) - rank(b.selector));
}

export function ConceptKeyboardV2() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const { threads, addReply, setKind, toggleResolve, create } = useThreads();
  const ordered = useMemo(() => docOrder(threads), [threads]);

  const heroIdx = Math.max(0, ordered.findIndex((t) => t.selector === '#hero-title'));
  const [focusedId, setFocusedId] = useState<string>(() => ordered[heroIdx]?.id ?? ordered[0]?.id);

  const [filter, setFilter] = useState<'all' | 'open'>('all');
  const [railOpen, setRailOpen] = useState(initialRailOpen);
  // auto-collapse below ~1366 / auto-expand at ≥1536, only on a boundary CROSSING so a manual
  // toggle persists within a band. (Also surfaces a one-shot hint the first time width forces it.)
  const lastBucket = useRef<'narrow' | 'mid' | 'wide'>(
    typeof window === 'undefined' ? 'wide' : widthBucket(window.innerWidth),
  );
  const [autoHint, setAutoHint] = useState(false);
  useEffect(() => {
    const onResize = () => {
      const b = widthBucket(window.innerWidth);
      if (b === lastBucket.current) return;
      lastBucket.current = b;
      if (b === 'narrow') { setRailOpen(false); setAutoHint(true); setTimeout(() => setAutoHint(false), 2600); }
      else if (b === 'wide') setRailOpen(true);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [mode, setMode] = useState<'idle' | 'aiming' | 'replying'>('idle');
  const [replyDraft, setReplyDraft] = useState('');
  const [draft, setDraft] = useState<{ selector: string; text: string; kind: PpThread['kind'] } | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [glowKey, setGlowKey] = useState(0);
  const [hoverEl, setHoverEl] = useState<string | null>(null);

  const rects = useAnchorRects(scrollRef.current, SELECTORS);

  const visible = useMemo(
    () => (filter === 'open' ? ordered.filter((t) => !t.resolved) : ordered),
    [ordered, filter],
  );
  const focused = useMemo(() => threads.find((t) => t.id === focusedId) ?? null, [threads, focusedId]);

  // shell offset (for translating viewport rects → overlay coords). Shell is the
  // full-viewport box; usually (0,0) but measured to stay correct if embedded.
  const [shellOff, setShellOff] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const r = shellRef.current?.getBoundingClientRect();
      if (r) setShellOff({ x: r.left, y: r.top });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // ---- toast ----
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((text: string, undo?: () => void) => {
    setToast({ text, undo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // ---- focus + scroll-to-frame (the j/k camera move) ----
  const frameThread = useCallback(
    (id: string) => {
      setFocusedId(id);
      setGlowKey((k) => k + 1);
      const t = threads.find((x) => x.id === id);
      const sc = scrollRef.current;
      if (!t || !sc) return;
      if (t.selector === '@page') {
        sc.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const elx = sc.querySelector(t.selector) as HTMLElement | null;
      if (!elx) return;
      const target = elx.offsetTop - sc.clientHeight * 0.38 + elx.offsetHeight / 2;
      sc.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    },
    [threads],
  );

  const move = useCallback(
    (delta: number) => {
      const list = visible;
      if (!list.length) return;
      const cur = list.findIndex((t) => t.id === focusedId);
      const next = cur === -1 ? 0 : Math.min(list.length - 1, Math.max(0, cur + delta));
      frameThread(list[next].id);
    },
    [visible, focusedId, frameThread],
  );

  // ---- create flow (shared by mouse "+" and keyboard c-then-click) ----
  const openDraftFor = useCallback((sel: string) => {
    setDraft({ selector: sel, text: '', kind: null });
    setMode('idle');
    setRailOpen(true);
    setTimeout(() => draftRef.current?.focus(), 40);
  }, []);

  const startAim = useCallback(() => {
    setMode('aiming');
  }, []);

  const doResolve = useCallback(
    (id: string) => {
      const t = threads.find((x) => x.id === id);
      const wasResolved = t?.resolved;
      toggleResolve(id);
      flash(wasResolved ? 'Reopened' : 'Resolved');
      if (!wasResolved && filter === 'open') {
        const list = visible.filter((x) => x.id !== id);
        const cur = visible.findIndex((x) => x.id === id);
        const nxt = list[Math.min(cur, list.length - 1)];
        if (nxt) frameThread(nxt.id);
      }
    },
    [threads, toggleResolve, flash, filter, visible, frameThread],
  );

  const commitReply = useCallback(() => {
    if (focusedId && replyDraft.trim()) {
      addReply(focusedId, replyDraft.trim());
      flash('Reply posted');
    }
    setReplyDraft('');
    setMode('idle');
  }, [focusedId, replyDraft, addReply, flash]);

  const commitDraft = useCallback(() => {
    if (draft && draft.text.trim()) {
      const t = create(draft.selector, draft.text.trim(), draft.kind);
      setFocusedId(t.id);
      flash('Comment added');
    }
    setDraft(null);
    setMode('idle');
  }, [draft, create, flash]);

  // aiming: click an element to anchor a draft (keyboard path)
  const onPageClickCapture = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== 'aiming') return;
      const el = (e.target as HTMLElement).closest(SELECTORS.join(',')) as HTMLElement | null;
      e.preventDefault();
      e.stopPropagation();
      openDraftFor(el ? '#' + el.id : '@page');
    },
    [mode, openDraftFor],
  );

  // ---- global keymap (minimal: j/k move · r resolve · c comment · \ hide · Esc) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      const typing = ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT');

      if (typing) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setMode('idle'); setDraft(null); setReplyDraft(''); ae?.blur();
        } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          if (draft) commitDraft();
          else if (mode === 'replying') commitReply();
        }
        return;
      }
      if (mode === 'aiming' && e.key === 'Escape') { e.preventDefault(); setMode('idle'); return; }

      // the whole grammar: step, resolve, comment, hide. Invisible-until-needed accelerators.
      switch (e.key) {
        case 'j': e.preventDefault(); move(1); break;
        case 'k': e.preventDefault(); move(-1); break;
        case 'r': e.preventDefault(); if (focusedId) doResolve(focusedId); break;
        case 'c': e.preventDefault(); startAim(); break;
        case '\\': e.preventDefault(); setRailOpen((v) => !v); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, draft, move, focusedId, doResolve, commitDraft, commitReply, startAim]);

  // ---- glow-ring (pre-measured for static first paint) ----
  const [glowRect, setGlowRect] = useState<{ left: number; top: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    const shell = shellRef.current;
    if (!sc || !shell || !focused || focused.selector === '@page') { setGlowRect(null); return; }
    const el = sc.querySelector(focused.selector) as HTMLElement | null;
    if (!el) { setGlowRect(null); return; }
    const er = el.getBoundingClientRect();
    const sr = shell.getBoundingClientRect();
    setGlowRect({ left: er.left - sr.left, top: er.top - sr.top, w: er.width, h: er.height });
  }, [focused, rects, glowKey]);

  useEffect(() => {
    const sc = scrollRef.current;
    const shell = shellRef.current;
    if (!sc || !shell) return;
    let raf = 0;
    const upd = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!focused || focused.selector === '@page') return;
        const el = sc.querySelector(focused.selector) as HTMLElement | null;
        if (!el) return;
        const er = el.getBoundingClientRect();
        const sr = shell.getBoundingClientRect();
        setGlowRect({ left: er.left - sr.left, top: er.top - sr.top, w: er.width, h: er.height });
      });
    };
    sc.addEventListener('scroll', upd, true);
    window.addEventListener('resize', upd);
    return () => { sc.removeEventListener('scroll', upd, true); window.removeEventListener('resize', upd); cancelAnimationFrame(raf); };
  }, [focused]);

  const accent = accentOf(focused?.kind ?? null);
  const counts = useMemo(() => ({ total: threads.length, open: threads.filter((t) => !t.resolved).length }), [threads]);

  return (
    <div ref={shellRef} className="relative h-screen overflow-hidden bg-white font-sans text-ink-800">
      <style>{`
        @keyframes kbd-bloom { 0% { opacity:0; transform:scale(1.05); } 40% { opacity:1; } 100% { opacity:.62; transform:scale(1); } }
        @keyframes kbd-pop { from { opacity:0; transform:translateY(6px) scale(.98); } to { opacity:1; transform:none; } }
        @media (prefers-reduced-motion: reduce) { .kbd-anim, .kbd-glow { animation: none !important; transition: none !important; } *{ scroll-behavior:auto !important; } }
      `}</style>

      {/* ===== page buffer — FULL WIDTH, scrolls underneath the floating drawer ===== */}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto"
        style={{ transition: `filter 240ms ${EASE}`, filter: mode === 'aiming' ? 'brightness(.96)' : 'none' }}
        onClickCapture={onPageClickCapture}
      >
        <ReviewPage />
      </div>

      {/* ===== interactive page layer: pins (click→select) + hover "+ comment" ===== */}
      <PageLayer
        rects={rects}
        shellOff={shellOff}
        threads={threads}
        filter={filter}
        selectedId={focusedId}
        hoverEl={hoverEl}
        mode={mode}
        accent={accent}
        glowRect={glowRect}
        glowKey={glowKey}
        focused={focused}
        onHoverEl={setHoverEl}
        onSelect={(id) => frameThread(id)}
        onCreateAt={openDraftFor}
        onArmedClick={(sel) => openDraftFor(sel)}
      />

      {/* aiming hint */}
      {mode === 'aiming' && (
        <div className="pointer-events-none absolute left-1/2 top-5 z-40 -translate-x-1/2 animate-[kbd-pop_.2s_ease] rounded-field bg-ink-900/92 px-3.5 py-2 text-xs font-medium text-white shadow-lift">
          Click an element to drop a comment · Esc to cancel
        </div>
      )}

      {/* ===== floating drawer (does NOT reserve page width) =====
          EDGE-GAP refinement: the page is centered (max-width) so the drawer's leading
          16px lands on the right gutter; we feather that strip to transparent (frosted)
          so the rare content that reaches it stays visible instead of being hard-covered.
          Page is never mutated/reflowed. For full-bleed pages the guaranteed escape is the
          collapse (\\ / the tab) — the "verify true layout" gesture. We deliberately do NOT
          make the whole drawer translucent (kills card legibility) or auto-yield the page
          (that reintroduces reflow); 320px is the floor at which ThreadCard reads cleanly. */}
      <aside
        className="absolute right-0 top-0 z-30 flex h-full flex-col backdrop-blur transition-transform duration-300"
        style={{
          width: DRAWER_W,
          transform: railOpen ? 'none' : `translateX(${DRAWER_W}px)`,
          boxShadow: '-10px 0 34px -20px rgba(17,22,27,.45)',
          // transparent for the leading 16px gutter, then opaque panel from the content edge in
          background: 'linear-gradient(to right, rgba(255,255,255,0) 0px, rgba(255,255,255,.97) 16px)',
        }}
      >
        {/* header */}
        <header className="flex-none border-b border-ink-100 pb-2.5 pl-[18px] pr-3.5 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[13px] font-bold tracking-tight text-ink-900">
              <span className="flex h-5 w-5 items-center justify-center rounded-chip bg-ink-900 text-white">
                <CommandIcon className="h-3 w-3" />
              </span>
              Review
            </div>
            <button
              onClick={() => setRailOpen(false)}
              title="Collapse drawer (\\)"
              className="grid h-6 w-6 place-items-center rounded-chip text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-ink-500">Orbit landing · {counts.total} threads</span>
            <div className="flex items-center rounded-chip border border-ink-200 p-0.5 text-[10px] font-semibold">
              {(['all', 'open'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="rounded-[5px] px-2 py-0.5 capitalize transition-colors"
                  style={{ background: filter === f ? '#11161b' : 'transparent', color: filter === f ? '#fff' : '#8a929b' }}
                >
                  {f === 'open' ? `Open ${counts.open}` : 'All'}
                </button>
              ))}
            </div>
          </div>
          {/* element comments come from the in-context hover "+ comment" pill (one loud path);
              this is just the one thing the pill can't express — a note on the whole page. */}
          <button
            onClick={() => openDraftFor('@page')}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-field border border-dashed border-ink-300 bg-ink-50/60 py-1.5 text-[12px] font-semibold text-ink-600 transition hover:border-tide-400 hover:bg-tide-50 hover:text-tide-700"
          >
            <Plus className="h-3.5 w-3.5" /> Note on the whole page
          </button>
        </header>

        {/* list */}
        <div className="min-h-0 flex-1 overflow-y-auto py-2.5 pl-[18px] pr-2.5">
          {visible.map((t) => (
            <ThreadCard
              key={t.id}
              thread={t}
              index={ordered.filter((x) => x.selector !== '@page').findIndex((x) => x.id === t.id)}
              focused={t.id === focusedId}
              replying={t.id === focusedId && mode === 'replying'}
              replyDraft={replyDraft}
              replyRef={replyRef}
              onClick={() => frameThread(t.id)}
              onReplyChange={setReplyDraft}
              onReplyCommit={commitReply}
              onResolve={() => doResolve(t.id)}
              onTag={(k) => setKind(t.id, k)}
              onReply={() => { setMode('replying'); setTimeout(() => replyRef.current?.focus(), 30); }}
            />
          ))}

          {draft && (
            <DraftCard
              draft={draft}
              draftRef={draftRef}
              onChange={(text) => setDraft((d) => (d ? { ...d, text } : d))}
              onTag={(k) => setDraft((d) => (d ? { ...d, kind: k } : d))}
              onCommit={commitDraft}
              onCancel={() => setDraft(null)}
            />
          )}
        </div>

        {/* hint strip */}
        <div className="flex-none border-t border-ink-100 bg-ink-50/70 py-2 pl-[18px] pr-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-ink-500">
            <Hint k="j/k" label="move" />
            <Hint k="c" label="comment" />
            <Hint k="r" label="resolve" />
            <Hint k="\\" label="hide" />
          </div>
        </div>

        {toast && (
          <div
            className="kbd-anim absolute bottom-12 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-field bg-ink-900 px-3 py-1.5 text-[12px] font-medium text-white"
            style={{ boxShadow: '0 10px 30px -8px rgba(0,0,0,.4)', animation: `kbd-pop 220ms ${EASE} both` }}
          >
            <Check className="h-3.5 w-3.5 text-tide-300" />
            {toast.text}
            {toast.undo && (
              <button
                onClick={() => { toast.undo!(); setToast(null); }}
                className="ml-1 flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-tide-300 transition hover:bg-white/10"
              >
                <RotateCcw className="h-3 w-3" /> Undo
              </button>
            )}
          </div>
        )}
      </aside>

      {/* collapsed tab — page is full-width, click to bring the drawer back */}
      {!railOpen && (
        <button
          onClick={() => setRailOpen(true)}
          className="absolute right-0 top-1/2 z-30 flex -translate-y-1/2 items-center gap-1.5 rounded-l-panel border border-r-0 border-ink-200 bg-white px-2 py-3 text-[11px] font-semibold text-ink-600 shadow-lift transition-transform hover:-translate-x-0.5"
          style={{ writingMode: 'vertical-rl' }}
        >
          <CommandIcon className="h-4 w-4 rotate-90" />
          Review · {counts.open} open
        </button>
      )}

      {/* one-shot hint when the narrow width auto-collapsed the drawer */}
      {autoHint && !railOpen && (
        <div className="animate-[kbd-pop_.2s_ease] absolute right-12 top-1/2 z-40 -translate-y-1/2 rounded-field bg-ink-900/92 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-lift">
          Narrow window — drawer tucked away so the page stays full-width
        </div>
      )}

    </div>
  );
}

/* ============================== page layer ============================ */
/* Pins (clickable → select) + hover "+ comment" affordance + glow-ring.   */
function PageLayer({
  rects, shellOff, threads, filter, selectedId, hoverEl, mode, accent, glowRect, glowKey, focused,
  onHoverEl, onSelect, onCreateAt, onArmedClick,
}: {
  rects: Record<string, DOMRect>;
  shellOff: { x: number; y: number };
  threads: PpThread[];
  filter: 'all' | 'open';
  selectedId: string;
  hoverEl: string | null;
  mode: 'idle' | 'aiming' | 'replying';
  accent: string;
  glowRect: { left: number; top: number; w: number; h: number } | null;
  glowKey: number;
  focused: PpThread | null;
  onHoverEl: (s: string | null) => void;
  onSelect: (id: string) => void;
  onCreateAt: (sel: string) => void;
  onArmedClick: (sel: string) => void;
}) {
  const bySel = useMemo(() => {
    const m: Record<string, PpThread> = {};
    for (const t of threads) if (t.selector !== '@page') m[t.selector] = t;
    return m;
  }, [threads]);

  const ox = shellOff.x;
  const oy = shellOff.y;

  return (
    <>
      {/* glow ring on the focused element (non-interactive) */}
      {glowRect && focused && !focused.resolved && (
        <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
          <div
            key={glowKey}
            className="kbd-glow absolute rounded-field"
            style={{
              left: glowRect.left - 5, top: glowRect.top - 5, width: glowRect.w + 10, height: glowRect.h + 10,
              boxShadow: `0 0 0 2px ${accent}, 0 0 0 7px ${accent}22, 0 0 26px 2px ${accent}33`,
              animation: `kbd-bloom 620ms ${EASE} both`,
            }}
          />
        </div>
      )}

      {/* interactive zones */}
      <div className="absolute inset-0 z-[18]">
        {SELECTORS.map((sel) => {
          const r = rects[sel];
          if (!r) return null;
          const left = r.left - ox;
          const top = r.top - oy;
          const t = bySel[sel];
          const shown = t && (filter === 'open' ? !t.resolved : true);
          const isSel = t && t.id === selectedId;
          const isHover = hoverEl === sel;
          const aiming = mode === 'aiming';
          const color = t ? (t.resolved ? '#9aa1a9' : accentOf(t.kind)) : '#14958a';

          return (
            <div key={sel}>
              {/* hit zone */}
              <div
                className="pointer-events-auto absolute"
                style={{ left, top, width: r.width, height: r.height }}
                onMouseEnter={() => onHoverEl(sel)}
                onMouseLeave={() => onHoverEl(null)}
                onClick={() => { if (aiming) onArmedClick(sel); else if (t) onSelect(t.id); }}
              >
                {/* hover / aiming / selected outline */}
                {(isHover || aiming || isSel) && (
                  <div
                    className="pointer-events-none absolute -inset-1 rounded-field transition-all duration-150"
                    style={{ boxShadow: `0 0 0 ${isSel ? 2 : 1.5}px ${aiming ? '#14958a' : color}${isSel ? '' : '99'}`, background: aiming ? 'rgba(20,149,138,0.05)' : 'transparent' }}
                  />
                )}
                {/* "+ comment" affordance on hover when no thread yet (and not aiming) */}
                {isHover && !t && !aiming && (
                  <button
                    className="pointer-events-auto absolute -right-1 -top-2.5 flex items-center gap-1 rounded-chip bg-tide-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow-lift transition-transform hover:scale-105"
                    onClick={(e) => { e.stopPropagation(); onCreateAt(sel); }}
                  >
                    <Plus className="h-2.5 w-2.5" /> comment
                  </button>
                )}
              </div>

              {/* numbered / resolved pin */}
              {shown && t && (
                <button
                  className="pointer-events-auto absolute z-10 flex -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border-2 border-white font-bold text-white transition-all"
                  style={{
                    left: r.right - ox, top: r.top - oy + 8,
                    width: isSel ? 22 : 18, height: isSel ? 22 : 18, fontSize: isSel ? 11 : 10,
                    background: color,
                    boxShadow: isSel ? `0 0 0 3px ${color}33, 0 2px 6px rgba(0,0,0,.28)` : '0 1px 3px rgba(0,0,0,.22)',
                    opacity: t.resolved ? 0.7 : 1,
                  }}
                  onMouseEnter={() => onHoverEl(sel)}
                  onMouseLeave={() => onHoverEl(null)}
                  onClick={() => onSelect(t.id)}
                >
                  {t.resolved ? <Check className="h-3 w-3" /> : t.comments.length}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ============================== sub-components ============================ */
function Hint({ k, label }: { k: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded-[4px] border border-ink-200 bg-white px-1 py-px text-[9.5px] font-bold text-ink-700 shadow-card">{k}</kbd>
      <span>{label}</span>
    </span>
  );
}

function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <span
      className="flex flex-none items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: avatarColor(name), fontSize: size * 0.42 }}
    >
      {initialOf(name)}
    </span>
  );
}

function KindChips({ active, onPick }: { active: PpThread['kind']; onPick: (k: PpThread['kind']) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {KIND_KEYS.map((k, i) => {
        const on = active === k;
        const c = KIND[k];
        return (
          <button
            key={k}
            onClick={(e) => { e.stopPropagation(); onPick(k); }}
            className="flex items-center gap-1 rounded-chip border px-1.5 py-0.5 text-[10px] font-semibold transition-colors"
            style={{ borderColor: on ? c.color : '#e7e9eb', background: on ? c.tint : '#fff', color: on ? c.ink : '#8a929b' }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
            {c.label}
            <span className="font-mono opacity-50">{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}

function ThreadCard({
  thread, index, focused, replying, replyDraft, replyRef,
  onClick, onReplyChange, onReplyCommit, onResolve, onTag, onReply,
}: {
  thread: PpThread;
  index: number;
  focused: boolean;
  replying: boolean;
  replyDraft: string;
  replyRef: React.RefObject<HTMLTextAreaElement>;
  onClick: () => void;
  onReplyChange: (v: string) => void;
  onReplyCommit: () => void;
  onResolve: () => void;
  onTag: (k: PpThread['kind']) => void;
  onReply: () => void;
}) {
  const c = accentOf(thread.kind);
  const isPage = thread.selector === '@page';
  const first = thread.comments[0];
  const resolved = thread.resolved;

  return (
    <div
      onClick={onClick}
      className="kbd-anim group relative mb-2 cursor-pointer overflow-hidden rounded-card border bg-white"
      style={{
        borderColor: focused ? '#d7dadd' : '#e7e9eb',
        boxShadow: focused ? '0 2px 8px rgba(17,22,27,.06), 0 14px 30px -12px rgba(17,22,27,.14)' : '0 1px 2px rgba(17,22,27,.04)',
        opacity: resolved && !focused ? 0.66 : 1,
        transition: `box-shadow 240ms ${EASE}, border-color 200ms, opacity 200ms`,
      }}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: resolved ? '#d7dadd' : c, transition: 'background 200ms' }} />

      {/* resolved + focused → an explicit resolved banner (never reads like an open thread) */}
      {resolved && focused && (
        <div className="flex items-center gap-1.5 bg-ink-50 px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-ink-500">
          <CheckCheck className="h-3 w-3 text-tide-600" /> Resolved
          <button
            onClick={(e) => { e.stopPropagation(); onResolve(); }}
            className="ml-auto flex items-center gap-1 rounded-chip border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold normal-case text-ink-600 transition hover:border-tide-300 hover:text-tide-700"
          >
            <RotateCcw className="h-2.5 w-2.5" /> Reopen
          </button>
        </div>
      )}

      <div className="py-2 pl-3 pr-2.5">
        <div className="flex items-center gap-2">
          <Avatar name={first.author_name} size={focused ? 24 : 20} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12.5px] font-semibold text-ink-900">{first.author_name}</span>
              {focused && <span className="text-[10px] text-ink-400">· {fmtTime(first.created_at)}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="truncate font-mono text-[10px]" style={{ color: resolved ? '#9aa1a9' : c }}>
                {isPage ? '@page' : `${index + 1} · #${anchorLabel(thread.selector)}`}
              </span>
            </div>
          </div>
          {resolved ? (
            !focused && (
              <span className="flex flex-none items-center gap-1 rounded-chip bg-ink-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-ink-500">
                <Check className="h-2.5 w-2.5" /> done
              </span>
            )
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onResolve(); }}
              title="Resolve (r)"
              className="flex h-6 w-6 flex-none items-center justify-center rounded-chip border border-ink-200 text-ink-400 opacity-0 transition-opacity hover:border-tide-400 hover:text-tide-600 group-hover:opacity-100"
              style={{ opacity: focused ? 1 : undefined }}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {focused ? (
          <div className="mt-2 space-y-2">
            {thread.comments.map((cm, i) => (
              <div key={cm.id} className={i === 0 ? '' : 'kbd-anim'} style={i > 0 ? { animation: `kbd-pop 240ms ${EASE} both` } : undefined}>
                {i > 0 && (
                  <div className="mb-1 flex items-center gap-1.5">
                    <Avatar name={cm.author_name} size={16} />
                    <span className="text-[11px] font-semibold text-ink-800">{cm.author_name}</span>
                    <span className="text-[10px] text-ink-400">· {fmtTime(cm.created_at)}</span>
                  </div>
                )}
                <p className="text-[12.5px] leading-relaxed text-ink-700" style={i > 0 ? { paddingLeft: 22 } : undefined}>{cm.text}</p>
              </div>
            ))}

            {!resolved && (
              <div className="pt-0.5">
                <KindChips active={thread.kind} onPick={onTag} />
              </div>
            )}

            {replying ? (
              <div className="rounded-field border border-ink-200 bg-ink-50 p-1.5">
                <textarea
                  ref={replyRef}
                  value={replyDraft}
                  onChange={(e) => onReplyChange(e.target.value)}
                  placeholder="Reply…  ⌘↵ to post · esc to cancel"
                  rows={2}
                  className="w-full resize-none bg-transparent px-1 text-[12.5px] leading-relaxed text-ink-800 outline-none placeholder:text-ink-400"
                />
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); onReplyCommit(); }}
                    className="flex items-center gap-1 rounded-chip bg-tide-600 px-2 py-1 text-[11px] font-semibold text-white"
                  >
                    Reply <CornerDownLeft className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onReply(); }}
                className="flex w-full items-center gap-1.5 rounded-field border border-dashed border-ink-200 px-2.5 py-1.5 text-[12px] text-ink-400 transition-colors hover:border-tide-300 hover:text-tide-600"
              >
                <Reply className="h-3.5 w-3.5" /> Reply
                <kbd className="ml-auto rounded-[4px] border border-ink-200 bg-white px-1 font-mono text-[9px] font-bold text-ink-500">e</kbd>
              </button>
            )}
          </div>
        ) : (
          <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-600" style={resolved ? { color: '#9aa1a9' } : undefined}>
            {first.text}
          </p>
        )}

        {!focused && (
          <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-ink-400">
            {thread.kind && (
              <span className="flex items-center gap-1 font-semibold" style={{ color: resolved ? '#9aa1a9' : c }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: resolved ? '#d7dadd' : c }} />
                {KIND[thread.kind].label}
              </span>
            )}
            {thread.comments.length > 1 && (
              <span className="flex items-center gap-1"><Reply className="h-2.5 w-2.5" />{thread.comments.length}</span>
            )}
            <span className="ml-auto">{fmtTime(first.created_at)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DraftCard({
  draft, draftRef, onChange, onTag, onCommit, onCancel,
}: {
  draft: { selector: string; text: string; kind: PpThread['kind'] };
  draftRef: React.RefObject<HTMLTextAreaElement>;
  onChange: (v: string) => void;
  onTag: (k: PpThread['kind']) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const c = accentOf(draft.kind);
  return (
    <div
      className="kbd-anim relative mb-2 overflow-hidden rounded-card border-2 bg-white"
      style={{ borderColor: c, boxShadow: '0 14px 30px -12px rgba(17,22,27,.18)', animation: `kbd-pop 200ms ${EASE} both` }}
    >
      <div className="p-2.5">
        <div className="mb-1.5 flex items-center gap-2">
          <Avatar name={VIEWER.name} size={20} />
          <span className="text-[12px] font-semibold text-ink-900">New comment</span>
          <span className="ml-auto rounded-chip bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-600">{draft.selector}</span>
        </div>
        <textarea
          ref={draftRef}
          value={draft.text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What needs changing here?"
          rows={2}
          autoFocus
          className="w-full resize-none rounded-field border border-ink-200 bg-ink-50 p-2 text-[12.5px] leading-relaxed text-ink-800 outline-none placeholder:text-ink-400 focus:border-tide-400"
        />
        <div className="mt-1.5"><KindChips active={draft.kind} onPick={onTag} /></div>
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <button onClick={onCancel} className="rounded-chip px-2 py-1 text-[11px] font-semibold text-ink-500 hover:text-ink-700">Cancel</button>
          <button onClick={onCommit} className="flex items-center gap-1 rounded-chip bg-tide-600 px-2.5 py-1 text-[11px] font-semibold text-white">
            Comment <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
