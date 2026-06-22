/**
 * ConceptKeyboard — "Cmd-K Review": a keyboard-first review cockpit.
 *
 * The page is the buffer, a slim docked right rail is the results panel, the
 * keyboard is the primary input. Keys are always live (no modes to toggle except
 * a transient 'aim' cursor after pressing c). j/k glide a single focus between
 * threads — the page smooth-scrolls so the anchored element parks at ~38% of the
 * viewport and blooms a soft kind-colored glow-ring — while the focused thread
 * reads inline in the rail (never over content). ⌘K absorbs every rarer action.
 *
 * Static first render: focus = copy@#hero-title (expanded, blue glow-ring already
 * painted via useLayoutEffect pre-measure) AND the ⌘K palette open with a sample
 * query + fuzzy results, so the screenshot reads instantly as "keyboard cockpit".
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
  FileText,
  Hash,
  Reply,
  Search,
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

/** Friendly label for a selector. */
const anchorLabel = (sel: string) =>
  sel === '@page' ? 'Whole page' : sel.replace(/^#/, '');

/** kind accent (falls back to neutral ink for untagged / @page). */
const accentOf = (k: PpThread['kind']) => (k ? KIND[k].color : '#6b7480');

/** Sort document order so j/k traverses top-to-bottom; @page pinned last. */
function docOrder(threads: PpThread[]): PpThread[] {
  const rank = (sel: string) => {
    const i = SELECTORS.indexOf(sel);
    return i === -1 ? SELECTORS.length + 1 : i;
  };
  return [...threads].sort((a, b) => rank(a.selector) - rank(b.selector));
}

export function ConceptKeyboard() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const railListRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);

  const { threads, addReply, setKind, toggleResolve, create } = useThreads();
  const ordered = useMemo(() => docOrder(threads), [threads]);

  // Focus the copy@#hero-title thread on first render (static-rich default).
  const heroIdx = Math.max(
    0,
    ordered.findIndex((t) => t.selector === '#hero-title'),
  );
  const [focusedId, setFocusedId] = useState<string>(() => ordered[heroIdx]?.id ?? ordered[0]?.id);

  const [filter, setFilter] = useState<'all' | 'open'>('all');
  const [filtering, setFiltering] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true); // open by default for the static shot
  const [query, setQuery] = useState('go to pricing'); // sample query, pre-typed
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [railOpen, setRailOpen] = useState(true);
  const [mode, setMode] = useState<'idle' | 'aiming' | 'replying'>('idle');
  const [replyDraft, setReplyDraft] = useState('');
  const [draft, setDraft] = useState<{ selector: string; text: string; kind: PpThread['kind'] } | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [glowKey, setGlowKey] = useState(0); // re-trigger glow bloom keyframe

  const rects = useAnchorRects(scrollRef.current, SELECTORS);

  const visible = useMemo(
    () => (filter === 'open' ? ordered.filter((t) => !t.resolved) : ordered),
    [ordered, filter],
  );
  const focused = useMemo(() => threads.find((t) => t.id === focusedId) ?? null, [threads, focusedId]);
  const focusedRect = focused ? rects[focused.selector] : undefined;

  // ---- toast helper -------------------------------------------------------
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((text: string, undo?: () => void) => {
    setToast({ text, undo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // ---- focus + scroll-to-frame (the j/k camera move) ----------------------
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
      // park the element at ~38% of the scroll viewport height
      const target =
        elx.offsetTop - sc.clientHeight * 0.38 + elx.offsetHeight / 2;
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

  // ---- palette results (fuzzy-ish over a small set) -----------------------
  type Cmd = { id: string; label: string; hint: string; icon: typeof Hash; run: () => void };
  const commands: Cmd[] = useMemo(() => {
    const goTo: Cmd[] = ordered
      .filter((t) => t.selector !== '@page')
      .map((t) => ({
        id: 'go-' + t.id,
        label: 'Go to #' + anchorLabel(t.selector),
        hint: t.kind ? KIND[t.kind].label : 'thread',
        icon: Hash,
        run: () => {
          setPaletteOpen(false);
          frameThread(t.id);
        },
      }));
    const actions: Cmd[] = [
      {
        id: 'new',
        label: 'New comment',
        hint: 'c',
        icon: CommandIcon,
        run: () => {
          setPaletteOpen(false);
          startAim();
        },
      },
      {
        id: 'resolve',
        label: 'Resolve thread',
        hint: 'r',
        icon: Check,
        run: () => {
          setPaletteOpen(false);
          if (focusedId) doResolve(focusedId);
        },
      },
      {
        id: 'page-note',
        label: 'Note on whole page',
        hint: '@page',
        icon: FileText,
        run: () => {
          setPaletteOpen(false);
          const t = create('@page', '', null);
          setFocusedId(t.id);
          setMode('replying');
          setReplyDraft('');
        },
      },
    ];
    return [...goTo, ...actions];
  }, [ordered, focusedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const score = (c: Cmd) => {
      const hay = (c.label + ' ' + c.hint).toLowerCase();
      if (hay.includes(q)) return 0;
      // light subsequence match
      let qi = 0;
      for (const ch of hay) if (ch === q[qi]) qi++;
      return qi === q.length ? 1 : 2;
    };
    return commands.filter((c) => score(c) < 2).sort((a, b) => score(a) - score(b));
  }, [commands, query]);

  useEffect(() => {
    if (paletteIdx >= results.length) setPaletteIdx(0);
  }, [results.length, paletteIdx]);

  // ---- actions ------------------------------------------------------------
  const startAim = useCallback(() => {
    setMode('aiming');
    setPaletteOpen(false);
  }, []);

  const doResolve = useCallback(
    (id: string) => {
      const t = threads.find((x) => x.id === id);
      toggleResolve(id);
      const wasResolved = t?.resolved;
      flash(wasResolved ? 'Reopened' : 'Resolved · u to undo', () => toggleResolve(id));
      // if open filter active and we just resolved, advance focus
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

  // aiming: click an element on the page to anchor a draft
  const onPageClickCapture = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== 'aiming') return;
      const el = (e.target as HTMLElement).closest(SELECTORS.join(',')) as HTMLElement | null;
      e.preventDefault();
      e.stopPropagation();
      const sel = el ? '#' + el.id : '@page';
      setDraft({ selector: sel, text: '', kind: null });
      setMode('idle');
      setTimeout(() => draftRef.current?.focus(), 30);
    },
    [mode],
  );

  // ---- global keymap ------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      const typing = ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT');

      // ⌘K / Ctrl-K toggles palette from anywhere
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      if (paletteOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setPaletteOpen(false);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setPaletteIdx((i) => Math.min(results.length - 1, i + 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setPaletteIdx((i) => Math.max(0, i - 1));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          results[paletteIdx]?.run();
        }
        return;
      }

      // typing into a composer / reply field: only Esc + ⌘Enter are global
      if (typing) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setMode('idle');
          setDraft(null);
          setReplyDraft('');
          ae?.blur();
        } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          if (draft) commitDraft();
          else if (mode === 'replying') commitReply();
        } else if (draft && '1234'.includes(e.key)) {
          // re-tag while composing
          e.preventDefault();
          setDraft((d) => (d ? { ...d, kind: KIND_KEYS[Number(e.key) - 1] } : d));
        }
        return;
      }

      if (mode === 'aiming' && e.key === 'Escape') {
        e.preventDefault();
        setMode('idle');
        return;
      }

      // single-key grammar
      switch (e.key) {
        case 'j':
          e.preventDefault();
          move(1);
          break;
        case 'k':
          e.preventDefault();
          move(-1);
          break;
        case 'g':
          e.preventDefault();
          if (gPending.current) {
            if (visible[0]) frameThread(visible[0].id);
            gPending.current = false;
          } else {
            gPending.current = true;
            setTimeout(() => (gPending.current = false), 500);
          }
          break;
        case 'G':
          e.preventDefault();
          if (visible.length) frameThread(visible[visible.length - 1].id);
          break;
        case 'e':
          e.preventDefault();
          if (focusedId) {
            setMode('replying');
            setTimeout(() => replyRef.current?.focus(), 30);
          }
          break;
        case 'r':
          e.preventDefault();
          if (focusedId) doResolve(focusedId);
          break;
        case 'c':
          e.preventDefault();
          startAim();
          break;
        case 'y':
          e.preventDefault();
          flash('Link copied');
          break;
        case '/':
          e.preventDefault();
          setFiltering(true);
          break;
        case '\\':
          e.preventDefault();
          setRailOpen((v) => !v);
          break;
        case 'u':
          if (toast?.undo) {
            e.preventDefault();
            toast.undo();
            setToast(null);
          }
          break;
        case '1':
        case '2':
        case '3':
        case '4':
          e.preventDefault();
          if (focusedId) {
            const k = KIND_KEYS[Number(e.key) - 1];
            setKind(focusedId, k);
            flash(KIND[k].label + ' tag');
          }
          break;
        case 'Escape':
          setFiltering(false);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    paletteOpen,
    results,
    paletteIdx,
    mode,
    draft,
    move,
    frameThread,
    focusedId,
    doResolve,
    commitDraft,
    commitReply,
    visible,
    startAim,
    flash,
    setKind,
    toast,
  ]);

  const gPending = useRef(false);

  // focus palette input when open
  useEffect(() => {
    if (paletteOpen) setTimeout(() => paletteInputRef.current?.focus(), 20);
  }, [paletteOpen]);

  // ---- glow-ring position (pre-measured for static first paint) -----------
  const [glowRect, setGlowRect] = useState<{ left: number; top: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    const shell = shellRef.current;
    if (!sc || !shell || !focused || focused.selector === '@page') {
      setGlowRect(null);
      return;
    }
    const el = sc.querySelector(focused.selector) as HTMLElement | null;
    if (!el) {
      setGlowRect(null);
      return;
    }
    const er = el.getBoundingClientRect();
    const sr = shell.getBoundingClientRect();
    setGlowRect({ left: er.left - sr.left, top: er.top - sr.top, w: er.width, h: er.height });
  }, [focused, rects, glowKey]);

  // keep glow following on scroll/resize even before useAnchorRects settles
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
    return () => {
      sc.removeEventListener('scroll', upd, true);
      window.removeEventListener('resize', upd);
      cancelAnimationFrame(raf);
    };
  }, [focused]);

  const accent = accentOf(focused?.kind ?? null);
  const counts = useMemo(
    () => ({ total: threads.length, open: threads.filter((t) => !t.resolved).length }),
    [threads],
  );

  return (
    <div
      ref={shellRef}
      className="relative flex h-screen overflow-hidden bg-ink-50 font-sans text-ink-800"
    >
      <style>{`
        @keyframes kbd-bloom { 0% { opacity:0; transform:scale(1.05); } 40% { opacity:1; } 100% { opacity:.62; transform:scale(1); } }
        @keyframes kbd-pop { from { opacity:0; transform:translateY(6px) scale(.98); } to { opacity:1; transform:none; } }
        @media (prefers-reduced-motion: reduce) {
          .kbd-anim, .kbd-glow { animation: none !important; transition: none !important; }
        }
      `}</style>

      {/* ===== page buffer (scrolls inside this pane) ===== */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto"
        style={{
          transition: `filter 240ms ${EASE}, opacity 240ms ${EASE}`,
          filter: mode === 'aiming' ? 'brightness(.94)' : 'none',
        }}
        onClickCapture={onPageClickCapture}
      >
        <ReviewPage />
        {mode === 'aiming' && <div style={{ height: 0 }} />}
      </div>

      {/* ===== glow-ring + faint numbered pins overlay (within scroll pane viewport) ===== */}
      <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
        {/* aiming overlay: crosshair outlines on anchorable elements */}
        {mode === 'aiming' &&
          SELECTORS.map((sel) => {
            const r = rects[sel];
            const shell = shellRef.current?.getBoundingClientRect();
            if (!r || !shell) return null;
            return (
              <div
                key={sel}
                className="absolute rounded-field"
                style={{
                  left: r.left - shell.left - 3,
                  top: r.top - shell.top - 3,
                  width: r.width + 6,
                  height: r.height + 6,
                  border: '1.5px dashed #14958a',
                  background: 'rgba(20,149,138,0.06)',
                }}
              />
            );
          })}

        {/* faint numbered pins on every anchored thread */}
        {ordered
          .filter((t) => t.selector !== '@page')
          .map((t, i) => {
            const r = rects[t.selector];
            const shell = shellRef.current?.getBoundingClientRect();
            if (!r || !shell) return null;
            const isFocus = t.id === focusedId;
            const c = accentOf(t.kind);
            return (
              <div
                key={t.id}
                className="absolute flex items-center justify-center rounded-full text-[10px] font-bold tabular-nums"
                style={{
                  left: r.right - shell.left - 9,
                  top: r.top - shell.top - 9,
                  width: 18,
                  height: 18,
                  background: isFocus ? c : '#fff',
                  color: isFocus ? '#fff' : c,
                  border: `1.5px solid ${c}`,
                  boxShadow: '0 1px 3px rgba(17,22,27,.18)',
                  opacity: t.resolved ? 0.35 : isFocus ? 1 : 0.6,
                  transition: `all 240ms ${EASE}`,
                }}
              >
                {i + 1}
              </div>
            );
          })}

        {/* the focused element's kind-colored glow-ring */}
        {glowRect && focused && !focused.resolved && (
          <div
            key={glowKey}
            className="kbd-glow absolute rounded-field"
            style={{
              left: glowRect.left - 5,
              top: glowRect.top - 5,
              width: glowRect.w + 10,
              height: glowRect.h + 10,
              boxShadow: `0 0 0 2px ${accent}, 0 0 0 7px ${accent}22, 0 0 26px 2px ${accent}33`,
              animation: `kbd-bloom 620ms ${EASE} both`,
            }}
          />
        )}
      </div>

      {/* ===== the cockpit rail ===== */}
      {railOpen ? (
        <aside
          className="relative z-30 flex h-full w-[300px] flex-none flex-col border-l border-ink-200 bg-white"
          style={{ boxShadow: '-8px 0 30px -22px rgba(17,22,27,.4)' }}
        >
          {/* header */}
          <header className="flex-none border-b border-ink-100 px-3.5 pb-2.5 pt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[13px] font-bold tracking-tight text-ink-900">
                <span className="flex h-5 w-5 items-center justify-center rounded-chip bg-ink-900 text-white">
                  <CommandIcon className="h-3 w-3" />
                </span>
                Review
              </div>
              <button
                onClick={() => setPaletteOpen(true)}
                className="flex items-center gap-1 rounded-chip border border-ink-200 bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-500 hover:text-ink-700"
              >
                ⌘K
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-ink-500">
                Orbit landing · {counts.total} threads
              </span>
              <div className="flex items-center rounded-chip border border-ink-200 p-0.5 text-[10px] font-semibold">
                {(['all', 'open'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className="rounded-[5px] px-2 py-0.5 capitalize transition-colors"
                    style={{
                      background: filter === f ? '#11161b' : 'transparent',
                      color: filter === f ? '#fff' : '#8a929b',
                    }}
                  >
                    {f === 'open' ? `Open ${counts.open}` : 'All'}
                  </button>
                ))}
              </div>
            </div>
            {filtering && (
              <div className="kbd-anim mt-2 flex items-center gap-1.5 rounded-field border border-tide-300 bg-tide-50/60 px-2 py-1">
                <Search className="h-3 w-3 text-tide-600" />
                <span className="font-mono text-[11px] text-tide-700">filter — o open · a all · esc</span>
                <button onClick={() => setFiltering(false)} className="ml-auto text-tide-600">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </header>

          {/* card list */}
          <div ref={railListRef} className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
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
                onReply={() => {
                  setMode('replying');
                  setTimeout(() => replyRef.current?.focus(), 30);
                }}
              />
            ))}

            {/* draft composer (after aiming-click) */}
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

          {/* foot hint strip */}
          <div className="flex-none border-t border-ink-100 bg-ink-50/70 px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-ink-500">
              <Hint k="c" label="new" />
              <Hint k="j/k" label="move" />
              <Hint k="e" label="reply" />
              <Hint k="r" label="resolve" />
              <Hint k="⌘K" label="all" />
            </div>
          </div>

          {/* toast */}
          {toast && (
            <div
              className="kbd-anim absolute bottom-12 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-field bg-ink-900 px-3 py-1.5 text-[12px] font-medium text-white"
              style={{ boxShadow: '0 10px 30px -8px rgba(0,0,0,.4)', animation: `kbd-pop 220ms ${EASE} both` }}
            >
              <Check className="h-3.5 w-3.5 text-tide-300" />
              {toast.text}
            </div>
          )}
        </aside>
      ) : (
        // collapsed spine
        <button
          onClick={() => setRailOpen(true)}
          className="relative z-30 flex h-full w-9 flex-none flex-col items-center gap-2 border-l border-ink-200 bg-white pt-4 text-ink-500 hover:text-ink-800"
        >
          <CommandIcon className="h-4 w-4" />
          <span
            className="mt-1 text-[10px] font-semibold tracking-wide"
            style={{ writingMode: 'vertical-rl' }}
          >
            REVIEW · {counts.open} open
          </span>
        </button>
      )}

      {/* ===== ⌘K command palette (the one intentional overlay) ===== */}
      {paletteOpen && (
        <div
          className="absolute inset-0 z-50 flex items-start justify-center"
          style={{ paddingTop: '14vh' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPaletteOpen(false);
          }}
        >
          <div
            className="absolute inset-0 bg-ink-900/30"
            style={{ backdropFilter: 'blur(1.5px)' }}
          />
          <div
            className="kbd-anim relative w-[520px] max-w-[88%] overflow-hidden rounded-card border border-ink-200 bg-white"
            style={{ boxShadow: '0 20px 50px -18px rgba(0,0,0,.5)', animation: `kbd-pop 160ms ${EASE} both` }}
          >
            {/* search field */}
            <div className="flex items-center gap-2.5 border-b border-ink-100 px-4 py-3">
              <Search className="h-4 w-4 flex-none text-ink-400" />
              <input
                ref={paletteInputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPaletteIdx(0);
                }}
                placeholder="Go to a thread, an element, or run a command…"
                className="w-full bg-transparent text-[14px] text-ink-900 outline-none placeholder:text-ink-400"
              />
              <kbd className="flex-none rounded-chip border border-ink-200 bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
                esc
              </kbd>
            </div>

            {/* results */}
            <div className="max-h-[300px] overflow-y-auto py-1.5">
              {results.length === 0 && (
                <div className="px-4 py-6 text-center text-[13px] text-ink-400">No matches</div>
              )}
              {results.map((c, i) => {
                const Icon = c.icon;
                const sel = i === paletteIdx;
                return (
                  <button
                    key={c.id}
                    onMouseEnter={() => setPaletteIdx(i)}
                    onClick={c.run}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left"
                    style={{ background: sel ? '#f4f5f6' : 'transparent' }}
                  >
                    <span
                      className="flex h-7 w-7 flex-none items-center justify-center rounded-field border"
                      style={{
                        borderColor: sel ? '#d7dadd' : '#e7e9eb',
                        background: sel ? '#fff' : '#fafafa',
                        color: sel ? '#3a424b' : '#8a929b',
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 truncate text-[13.5px] font-medium text-ink-800">{c.label}</span>
                    <span className="flex-none rounded-chip bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
                      {c.hint}
                    </span>
                    {sel && <CornerDownLeft className="h-3.5 w-3.5 flex-none text-ink-400" />}
                  </button>
                );
              })}
            </div>

            {/* palette foot */}
            <div className="flex items-center justify-between border-t border-ink-100 bg-ink-50/70 px-4 py-2 font-mono text-[10px] text-ink-400">
              <span className="flex items-center gap-1.5">
                <CheckCheck className="h-3 w-3" /> {counts.open} open · {counts.total - counts.open} resolved
              </span>
              <span>↑↓ navigate · ↵ select</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================== sub-components ============================ */

function Hint({ k, label }: { k: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded-[4px] border border-ink-200 bg-white px-1 py-px text-[9.5px] font-bold text-ink-700 shadow-card">
        {k}
      </kbd>
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

function KindChips({
  active,
  onPick,
  size = 'sm',
}: {
  active: PpThread['kind'];
  onPick: (k: PpThread['kind']) => void;
  size?: 'sm' | 'xs';
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {KIND_KEYS.map((k, i) => {
        const on = active === k;
        const c = KIND[k];
        return (
          <button
            key={k}
            onClick={(e) => {
              e.stopPropagation();
              onPick(k);
            }}
            className="flex items-center gap-1 rounded-chip border px-1.5 py-0.5 text-[10px] font-semibold transition-colors"
            style={{
              borderColor: on ? c.color : '#e7e9eb',
              background: on ? c.tint : '#fff',
              color: on ? c.ink : '#8a929b',
            }}
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
  thread,
  index,
  focused,
  replying,
  replyDraft,
  replyRef,
  onClick,
  onReplyChange,
  onReplyCommit,
  onResolve,
  onTag,
  onReply,
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
        boxShadow: focused
          ? '0 2px 8px rgba(17,22,27,.06), 0 14px 30px -12px rgba(17,22,27,.14)'
          : '0 1px 2px rgba(17,22,27,.04)',
        opacity: resolved && !focused ? 0.7 : 1,
        transition: `box-shadow 240ms cubic-bezier(.2,.8,.3,1), border-color 200ms, opacity 200ms`,
      }}
    >
      {/* kind accent bar */}
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: resolved ? '#d7dadd' : c, transition: 'background 200ms' }}
      />

      <div className="py-2 pl-3 pr-2.5">
        {/* head row */}
        <div className="flex items-center gap-2">
          <Avatar name={first.author_name} size={focused ? 24 : 20} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12.5px] font-semibold text-ink-900">{first.author_name}</span>
              {focused && <span className="text-[10px] text-ink-400">· {fmtTime(first.created_at)}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="truncate font-mono text-[10px]"
                style={{ color: resolved ? '#9aa1a9' : c }}
              >
                {isPage ? '@page' : `${index + 1} · #${anchorLabel(thread.selector)}`}
              </span>
            </div>
          </div>
          {resolved ? (
            <span className="flex flex-none items-center gap-1 rounded-chip bg-ink-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-ink-500">
              <Check className="h-2.5 w-2.5" /> done
            </span>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onResolve();
              }}
              title="Resolve (r)"
              className="flex h-6 w-6 flex-none items-center justify-center rounded-chip border border-ink-200 text-ink-400 opacity-0 transition-opacity hover:border-tide-400 hover:text-tide-600 group-hover:opacity-100"
              style={{ opacity: focused ? 1 : undefined }}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* body */}
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
                <p
                  className="text-[12.5px] leading-relaxed text-ink-700"
                  style={i > 0 ? { paddingLeft: 22 } : undefined}
                >
                  {cm.text}
                </p>
              </div>
            ))}

            {/* tag chips */}
            <div className="pt-0.5">
              <KindChips active={thread.kind} onPick={onTag} />
            </div>

            {/* reply zone */}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      onReplyCommit();
                    }}
                    className="flex items-center gap-1 rounded-chip bg-tide-600 px-2 py-1 text-[11px] font-semibold text-white"
                  >
                    Reply <CornerDownLeft className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReply();
                }}
                className="flex w-full items-center gap-1.5 rounded-field border border-dashed border-ink-200 px-2.5 py-1.5 text-[12px] text-ink-400 transition-colors hover:border-tide-300 hover:text-tide-600"
              >
                <Reply className="h-3.5 w-3.5" /> Reply
                <kbd className="ml-auto rounded-[4px] border border-ink-200 bg-white px-1 font-mono text-[9px] font-bold text-ink-500">
                  e
                </kbd>
              </button>
            )}
          </div>
        ) : (
          <p
            className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-600"
            style={resolved ? { color: '#9aa1a9' } : undefined}
          >
            {first.text}
          </p>
        )}

        {/* condensed footer */}
        {!focused && (
          <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-ink-400">
            {thread.kind && (
              <span className="flex items-center gap-1 font-semibold" style={{ color: resolved ? '#9aa1a9' : c }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: resolved ? '#d7dadd' : c }} />
                {KIND[thread.kind].label}
              </span>
            )}
            {thread.comments.length > 1 && (
              <span className="flex items-center gap-1">
                <Reply className="h-2.5 w-2.5" />
                {thread.comments.length}
              </span>
            )}
            <span className="ml-auto">{fmtTime(first.created_at)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  draftRef,
  onChange,
  onTag,
  onCommit,
  onCancel,
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
          <span className="ml-auto rounded-chip bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-600">
            {draft.selector}
          </span>
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
        <div className="mt-1.5">
          <KindChips active={draft.kind} onPick={onTag} />
        </div>
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <button onClick={onCancel} className="rounded-chip px-2 py-1 text-[11px] font-semibold text-ink-500 hover:text-ink-700">
            Cancel
          </button>
          <button
            onClick={onCommit}
            className="flex items-center gap-1 rounded-chip bg-tide-600 px-2.5 py-1 text-[11px] font-semibold text-white"
          >
            Comment <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
