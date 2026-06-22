/**
 * ConceptTideline — "Tideline" (slug: tideline) · the PHONE / narrow form factor.
 *
 * The gap none of the desktop concepts cover: review on a 320–480px one-handed phone,
 * where a 300px+ side drawer is impossible. A Maps-style draggable BOTTOM SHEET docks
 * the ~5 threads to the bottom edge while the hosted page renders UNTOUCHED at its true
 * mobile width above it — same fidelity guarantee as desktop v2, moved to the bottom edge
 * where a phone has room. Detents: PEEK (glance) / HALF (read) / FULL (list).
 *
 * Chosen by a diverge→judge→critique workflow over 6 candidates (92/100), then hardened
 * against 20 adversarial findings. Baked-in fixes:
 *  - CREATE is an always-visible, unmistakable affordance: a comment-bubble "+ Note" FAB
 *    in the RIGHT thumb corner (never the page's teal CTA colour by accident, never a
 *    fade-away label).
 *  - AIM mode is LOUD and bottom-anchored: page dims hard + the 7 commentable elements
 *    light up (no hover on a phone) + a bottom instruction chip; an off-target tap snaps
 *    to the NEAREST anchor (coarse thumb tap), never silently becomes an @page note.
 *  - The sheet teaches its own draggability: a one-time peek-bounce on mount + the WHOLE
 *    peek bar (not a 5px handle) opens it.
 *  - The camera parks the anchor in the LIVE clear zone above the sheet (computed from the
 *    sheet's top edge), not a magic viewport fraction — so the discussed element is never
 *    under the sheet.
 *  - Footer clearance comes from scroll-padding on the overlay's own scroll container,
 *    NEVER a spacer injected into the page (that would mutate the hosted layout).
 *  - Resolve is the explicit Check button (+ undo); kind dots count THREADS (neutral dot
 *    for untagged / @page), not just kinds.
 *
 * Rendered inside a phone device frame so the mobile model is legible at any card size;
 * on a real ≥768px + fine-pointer device this converges to the v2 floating drawer.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Check, ChevronLeft, ChevronRight, ChevronUp, CornerDownLeft,
  MessageSquarePlus, RotateCcw, X,
} from 'lucide-react';
import { ReviewPage } from './review-page';
import {
  KIND, KIND_KEYS, VIEWER, avatarColor, fmtTime, initialOf, useAnchorRects, useThreads, type PpThread,
} from './concept-kit';

const SELECTORS = ['#hero-title', '#hero-sub', '#hero-cta', '#feature-1', '#feature-2', '#feature-3', '#pricing'];
const EASE = 'cubic-bezier(.2,.8,.3,1)';

// Phone device interior (the "screen"). All review chrome is absolute within it.
const SCREEN_W = 390;
const SCREEN_H = 812;
const PEEK = 76;
const HALF = Math.round(SCREEN_H * 0.56); // ~455
const FULL = Math.round(SCREEN_H * 0.92); // ~747
type Detent = 'peek' | 'half' | 'full';
const DETENT_H: Record<Detent, number> = { peek: PEEK, half: HALF, full: FULL };

const accentOf = (k: PpThread['kind']) => (k ? KIND[k].color : '#8a929b');
const anchorLabel = (sel: string) => (sel === '@page' ? 'Whole page' : sel.replace(/^#/, ''));

/** document order; @page pinned last (it has no pin on the page). */
function docOrder(threads: PpThread[]): PpThread[] {
  const rank = (s: string) => {
    const i = SELECTORS.indexOf(s);
    return i === -1 ? SELECTORS.length + 1 : i;
  };
  return [...threads].sort((a, b) => rank(a.selector) - rank(b.selector));
}

export function ConceptTideline() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const { threads, addReply, setKind, toggleResolve, create } = useThreads();
  const ordered = useMemo(() => docOrder(threads), [threads]);

  const [detent, setDetent] = useState<Detent>('peek');
  const [dragY, setDragY] = useState<number | null>(null); // live translateY while dragging
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open'>('all');
  const [aiming, setAiming] = useState(false);
  const [draft, setDraft] = useState<{ selector: string; text: string; kind: PpThread['kind'] } | null>(null);
  const [replyText, setReplyText] = useState('');
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [glowKey, setGlowKey] = useState(0);
  const [bounce, setBounce] = useState(false);

  const rects = useAnchorRects(scrollRef.current, SELECTORS);
  const [frameOff, setFrameOff] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const r = screenRef.current?.getBoundingClientRect();
      if (r) setFrameOff({ x: r.left, y: r.top });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const visible = useMemo(
    () => (filter === 'open' ? ordered.filter((t) => !t.resolved) : ordered),
    [ordered, filter],
  );
  const selected = useMemo(() => threads.find((t) => t.id === selectedId) ?? null, [threads, selectedId]);
  const counts = useMemo(
    () => ({ total: threads.length, open: threads.filter((t) => !t.resolved).length, resolved: threads.filter((t) => t.resolved).length }),
    [threads],
  );

  // one-time peek-bounce so the sheet visibly signals "drag me up"
  useEffect(() => {
    const t = setTimeout(() => setBounce(true), 520);
    const t2 = setTimeout(() => setBounce(false), 1320);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, []);

  // ---- toast ----
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((text: string, undo?: () => void) => {
    setToast({ text, undo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // ---- camera: park element in the LIVE clear zone above the sheet ----
  const flyTo = useCallback((sel: string, atDetent: Detent) => {
    const sc = scrollRef.current;
    if (!sc || sel === '@page') { sc?.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const el = sc.querySelector(sel) as HTMLElement | null;
    if (!el) return;
    const clearZone = SCREEN_H - DETENT_H[atDetent]; // y of the sheet's top edge = height of the visible strip
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // park the anchor in the LIVE clear zone above the sheet: center short elements at ~45%
    // of the strip; align a too-tall element's top near the top so its start is always visible.
    const top = el.offsetHeight > clearZone
      ? el.offsetTop - clearZone * 0.12
      : el.offsetTop + el.offsetHeight / 2 - clearZone * 0.45;
    sc.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  const selectThread = useCallback((id: string) => {
    const t = threads.find((x) => x.id === id);
    setSelectedId(id);
    setGlowKey((k) => k + 1);
    const next: Detent = detent === 'peek' ? 'half' : detent;
    setDetent(next);
    if (t && t.selector !== '@page') flyTo(t.selector, next);
    else scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [threads, detent, flyTo]);

  const step = useCallback((dir: 1 | -1) => {
    if (!visible.length) return;
    const i = visible.findIndex((t) => t.id === selectedId);
    const ni = i < 0 ? 0 : (i + dir + visible.length) % visible.length;
    selectThread(visible[ni].id);
  }, [visible, selectedId, selectThread]);

  // ---- handle drag → snap to nearest detent (handle/chrome only) ----
  const drag = useRef<{ startY: number; baseTop: number } | null>(null);
  const sheetTopForDetent = (d: Detent) => SCREEN_H - DETENT_H[d];
  const onHandleDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, baseTop: dragY ?? sheetTopForDetent(detent) };
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.startY;
    const top = Math.min(SCREEN_H - PEEK, Math.max(SCREEN_H - FULL, drag.current.baseTop + dy));
    setDragY(top);
  };
  const onHandleUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const top = dragY ?? sheetTopForDetent(detent);
    // snap to nearest detent top
    const cand: Detent[] = ['peek', 'half', 'full'];
    let best: Detent = 'peek'; let bd = Infinity;
    for (const d of cand) { const dd = Math.abs(sheetTopForDetent(d) - top); if (dd < bd) { bd = dd; best = d; } }
    drag.current = null;
    setDragY(null);
    setDetent(best);
  };

  // ---- create ----
  const startAim = () => { setAiming(true); setDetent('peek'); setSelectedId(null); };
  const onPageClickCaptureAim = (e: React.MouseEvent) => {
    if (!aiming) return;
    e.preventDefault(); e.stopPropagation();
    // nearest anchorable element by center distance to the tap (coarse thumb tap)
    const px = e.clientX, py = e.clientY;
    let best: string | null = null; let bd = Infinity;
    for (const sel of SELECTORS) {
      const r = rects[sel];
      if (!r) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(px - cx, py - cy);
      if (d < bd) { bd = d; best = sel; }
    }
    setAiming(false);
    setDraft({ selector: best ?? '@page', text: '', kind: null });
    setDetent('half');
    if (best) flyTo(best, 'half');
    setTimeout(() => draftRef.current?.focus(), 60);
  };
  const commitDraft = () => {
    if (!draft || !draft.text.trim()) { setDraft(null); return; }
    const t = create(draft.selector, draft.text.trim(), draft.kind);
    setDraft(null);
    setSelectedId(t.id);
    flash('Comment added');
  };

  const doResolve = (t: PpThread) => {
    const wasResolved = t.resolved;
    toggleResolve(t.id);
    flash(wasResolved ? 'Reopened' : 'Resolved', wasResolved ? undefined : () => toggleResolve(t.id));
    if (!wasResolved && filter === 'open') {
      const list = visible.filter((x) => x.id !== t.id);
      const i = visible.findIndex((x) => x.id === t.id);
      const nxt = list[Math.min(i, list.length - 1)];
      if (nxt) selectThread(nxt.id); else setSelectedId(null);
    }
  };

  const postReply = (id: string) => {
    if (!replyText.trim()) return;
    addReply(id, replyText.trim());
    setReplyText('');
    flash('Reply posted');
  };

  // ---- sheet position ----
  const sheetTop = dragY ?? sheetTopForDetent(bounce && detent === 'peek' ? 'peek' : detent);
  const bounceShift = bounce && detent === 'peek' && dragY == null ? -12 : 0;
  const expanded = detent !== 'peek';

  // frame-local rect for an anchor
  const localRect = (sel: string) => {
    const r = rects[sel];
    if (!r) return null;
    return { left: r.left - frameOff.x, top: r.top - frameOff.y, width: r.width, height: r.height, right: r.right - frameOff.x };
  };

  return (
    <div className="grid min-h-screen place-items-center bg-ink-100 p-6 font-sans">
      <style>{`
        @keyframes tl-bloom { 0%{opacity:0;transform:scale(1.06)} 40%{opacity:1} 100%{opacity:.6;transform:scale(1)} }
        @keyframes tl-pop { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        @media (prefers-reduced-motion: reduce){ .tl-anim{animation:none!important} *{scroll-behavior:auto!important} }
      `}</style>

      <div className="flex flex-col items-center gap-3">
        {/* device frame */}
        <div
          ref={screenRef}
          className="relative overflow-hidden rounded-[40px] border-[11px] border-ink-900 bg-white"
          style={{ width: SCREEN_W + 22, height: SCREEN_H + 22, boxShadow: '0 30px 60px -22px rgba(17,22,27,.5)' }}
        >
          <div className="relative h-full w-full overflow-hidden rounded-[30px]">
            {/* ===== page layer — full bleed, true mobile width, never mutated ===== */}
            <div
              ref={scrollRef}
              className="absolute inset-0 overflow-y-auto"
              style={{
                scrollPaddingBottom: PEEK,
                paddingBottom: 0,
                transition: `filter 200ms ${EASE}`,
                filter: aiming ? 'brightness(.82) saturate(.9)' : 'none',
              }}
              onClickCapture={onPageClickCaptureAim}
            >
              <ReviewPage />
              {/* overlay-owned footer clearance: lets the page's own footer rest clear of PEEK
                  WITHOUT injecting a node into the page's box (scroll-area padding only). */}
              <div aria-hidden style={{ height: PEEK }} className="pointer-events-none" />
            </div>

            {/* ===== pins + glow + aim-zones overlay ===== */}
            <div className="pointer-events-none absolute inset-0 z-20">
              {/* aim: light up the commentable elements (no hover on a phone) */}
              {aiming && SELECTORS.map((sel) => {
                const b = localRect(sel);
                if (!b) return null;
                return (
                  <div key={sel} className="absolute rounded-field"
                    style={{ left: b.left - 3, top: b.top - 3, width: b.width + 6, height: b.height + 6, border: '1.5px dashed #14958a', background: 'rgba(20,149,138,.08)' }} />
                );
              })}

              {/* glow ring on the focused element */}
              {!aiming && selected && selected.selector !== '@page' && !selected.resolved && (() => {
                const b = localRect(selected.selector);
                if (!b) return null;
                const c = accentOf(selected.kind);
                return (
                  <div key={glowKey} className="tl-anim absolute rounded-field"
                    style={{ left: b.left - 5, top: b.top - 5, width: b.width + 10, height: b.height + 10, boxShadow: `0 0 0 2px ${c}, 0 0 0 7px ${c}22, 0 0 24px 2px ${c}33`, animation: `tl-bloom 600ms ${EASE} both` }} />
                );
              })()}

              {/* numbered pins (28px visual / 44px hit), inset from the right edge */}
              {!aiming && ordered.filter((t) => t.selector !== '@page').map((t, i) => {
                const b = localRect(t.selector);
                if (!b) return null;
                if (filter === 'open' && t.resolved) return null;
                const c = t.resolved ? '#9aa1a9' : accentOf(t.kind);
                const isSel = t.id === selectedId;
                const px = Math.min(b.right, SCREEN_W - 18); // keep out of the right-edge gutter
                return (
                  <button key={t.id}
                    className="pointer-events-auto absolute grid -translate-y-1/2 translate-x-[-50%] place-items-center"
                    style={{ left: px, top: b.top + 10, width: 44, height: 44 }}
                    onClick={() => selectThread(t.id)}
                  >
                    <span className="grid place-items-center rounded-full border-2 border-white font-bold text-white"
                      style={{ width: isSel ? 28 : 24, height: isSel ? 28 : 24, fontSize: isSel ? 12 : 11, background: c, boxShadow: isSel ? `0 0 0 3px ${c}33, 0 2px 6px rgba(0,0,0,.3)` : '0 1px 4px rgba(0,0,0,.28)' }}>
                      {t.resolved ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* aim instruction chip — bottom-anchored, where the thumb is */}
            {aiming && (
              <div className="tl-anim absolute inset-x-0 z-40 flex items-center justify-center gap-2 px-4" style={{ bottom: PEEK + 14, animation: `tl-pop 180ms ${EASE} both` }}>
                <div className="flex items-center gap-2 rounded-panel bg-ink-900/95 px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-lift">
                  Tap the part you want to comment on
                  <button onClick={(e) => { e.stopPropagation(); setAiming(false); }} className="ml-1 rounded-chip bg-white/15 px-2 py-0.5 text-[11px]">Cancel</button>
                </div>
              </div>
            )}

            {/* ===== bottom sheet ===== */}
            <div
              className="absolute inset-x-0 z-30 flex flex-col rounded-t-[20px] border-t border-ink-200 bg-white/97 backdrop-blur"
              style={{
                top: sheetTop + bounceShift,
                height: FULL,
                boxShadow: '0 -10px 34px -16px rgba(17,22,27,.4)',
                transition: dragY == null ? `top 260ms ${EASE}` : 'none',
              }}
            >
              {/* grab + peek bar (the whole bar opens it) */}
              <div
                className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
                onPointerDown={onHandleDown}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onClick={() => { if (dragY == null) setDetent(expanded ? 'peek' : 'half'); }}
              >
                <div className="mx-auto mt-2 h-1.5 w-9 rounded-full bg-ink-300" />
                {counts.total === 0 ? (
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-[13px] font-semibold text-ink-500">No notes yet</span>
                    <FabButton onClick={(e) => { e.stopPropagation(); startAim(); }} />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3.5 py-2.5">
                    {/* low-value expand chevron on the LEFT (hard thumb corner) */}
                    <ChevronUp className={`h-4 w-4 shrink-0 text-ink-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    {/* center: thread-count + mix dots */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-bold text-ink-900">{counts.total} notes</span>
                        <span className="text-[12px] text-ink-400">· {counts.open} open</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        {ordered.map((t) => (
                          <span key={t.id} className="h-2 w-2 rounded-full" style={{ background: t.resolved ? '#d7dadd' : accentOf(t.kind), opacity: t.resolved ? 0.6 : 1 }} />
                        ))}
                      </div>
                    </div>
                    {/* primary CREATE — right thumb corner, bubble + persistent label */}
                    <FabButton onClick={(e) => { e.stopPropagation(); startAim(); }} />
                  </div>
                )}
              </div>

              {/* list / draft (scrolls; sheet drag is handle-only) */}
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
                {/* filter */}
                {counts.total > 0 && !draft && (
                  <div className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-1.5 bg-white/95 px-1 pb-2 pt-1 backdrop-blur">
                    <div className="flex rounded-chip border border-ink-200 p-0.5 text-[11px] font-semibold">
                      {(['all', 'open'] as const).map((f) => (
                        <button key={f} onClick={() => setFilter(f)} className="rounded-[6px] px-2.5 py-0.5 capitalize transition"
                          style={{ background: filter === f ? '#11161b' : 'transparent', color: filter === f ? '#fff' : '#8a929b' }}>
                          {f === 'open' ? `Open ${counts.open}` : 'All'}
                        </button>
                      ))}
                    </div>
                    {counts.resolved > 0 && <span className="ml-auto text-[11px] text-ink-400">{counts.resolved} resolved</span>}
                  </div>
                )}

                {draft ? (
                  <DraftCard draft={draft} draftRef={draftRef}
                    onChange={(text) => setDraft((d) => (d ? { ...d, text } : d))}
                    onTag={(k) => setDraft((d) => (d ? { ...d, kind: k } : d))}
                    onCommit={commitDraft} onCancel={() => setDraft(null)} />
                ) : (
                  visible.map((t) => (
                    <SheetCard key={t.id} thread={t}
                      index={ordered.filter((x) => x.selector !== '@page').findIndex((x) => x.id === t.id)}
                      focused={t.id === selectedId} expanded={expanded}
                      pos={visible.findIndex((x) => x.id === t.id) + 1} total={visible.length}
                      replyText={replyText} replyRef={replyRef}
                      onOpen={() => selectThread(t.id)}
                      onStep={step}
                      onReplyChange={setReplyText} onReplyCommit={() => postReply(t.id)}
                      onResolve={() => doResolve(t)} onTag={(k) => setKind(t.id, k)} />
                  ))
                )}
                {visible.length === 0 && counts.total > 0 && (
                  <div className="px-3 py-8 text-center text-[12.5px] text-ink-400">No open notes — all resolved.</div>
                )}
              </div>

              {/* undo toast docked above the sheet content bottom */}
              {toast && (
                <div className="tl-anim absolute left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-field bg-ink-900 px-3 py-1.5 text-[12px] font-medium text-white"
                  style={{ top: -44, boxShadow: '0 10px 30px -8px rgba(0,0,0,.4)', animation: `tl-pop 200ms ${EASE} both` }}>
                  <Check className="h-3.5 w-3.5 text-tide-300" /> {toast.text}
                  {toast.undo && (
                    <button onClick={() => { toast.undo!(); setToast(null); }} className="ml-1 flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-tide-300 hover:bg-white/10">
                      <RotateCcw className="h-3 w-3" /> Undo
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="max-w-[412px] text-center text-[12px] leading-relaxed text-ink-500">
          Phone form factor — the page renders at its <b>true mobile width</b>; the review sheet docks to the bottom (drag the handle to PEEK / HALF / FULL, tap a pin to fly, <b>+ Note</b> to comment). On a ≥768px device with a pointer it converges to the desktop drawer.
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------- FAB ----------------------------------- */
function FabButton({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-panel bg-tide-600 px-3 py-2 text-[12.5px] font-bold text-white shadow-card transition active:scale-95"
      style={{ minHeight: 40 }}>
      <MessageSquarePlus className="h-4 w-4" /> Note
    </button>
  );
}

/* ------------------------------- sheet card ------------------------------- */
function SheetCard(props: {
  thread: PpThread; index: number; focused: boolean; expanded: boolean; pos: number; total: number;
  replyText: string; replyRef: React.RefObject<HTMLTextAreaElement>;
  onOpen: () => void; onStep: (d: 1 | -1) => void;
  onReplyChange: (s: string) => void; onReplyCommit: () => void;
  onResolve: () => void; onTag: (k: PpThread['kind']) => void;
}) {
  const t = props.thread;
  const open = props.focused && props.expanded;
  const c = t.resolved ? '#9aa1a9' : accentOf(t.kind);
  const first = t.comments[0];
  const label = t.kind ? KIND[t.kind].label : t.selector === '@page' ? 'Whole page' : 'Note';

  if (!open) {
    return (
      <button onClick={props.onOpen}
        className="relative mb-2 flex w-full items-center gap-2.5 overflow-hidden rounded-card border bg-white px-3 py-2.5 text-left"
        style={{ borderColor: props.focused ? '#d7dadd' : '#e7e9eb', boxShadow: props.focused ? '0 6px 18px -10px rgba(17,22,27,.2)' : '0 1px 2px rgba(17,22,27,.04)', opacity: t.resolved ? 0.7 : 1 }}>
        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: c }} />
        <Avatar name={first.author_name} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="rounded-chip px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide" style={{ background: t.resolved ? '#f0f1f2' : (t.kind ? KIND[t.kind].tint : '#f0f1f2'), color: c }}>{label}</span>
            <span className="truncate font-mono text-[10px] text-ink-400">{t.selector === '@page' ? '@page' : t.selector}</span>
            {t.comments.length > 1 && <span className="ml-auto shrink-0 text-[10.5px] text-ink-400">{t.comments.length}</span>}
            {t.resolved && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-400" />}
          </div>
          <p className="mt-0.5 truncate text-[12.5px] text-ink-600">{first.text}</p>
        </div>
      </button>
    );
  }

  return (
    <div className="relative mb-2 overflow-hidden rounded-card border border-ink-300 bg-white" style={{ boxShadow: '0 10px 30px -12px rgba(17,22,27,.2)' }}>
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: c }} />
      {t.resolved && (
        <div className="flex items-center gap-1.5 bg-ink-50 px-3.5 py-1.5 pl-4 text-[10.5px] font-bold uppercase tracking-wide text-ink-500">
          <Check className="h-3 w-3 text-tide-600" /> Resolved
          <button onClick={props.onResolve} className="ml-auto flex items-center gap-1 rounded-chip border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold normal-case text-ink-600 hover:border-tide-300 hover:text-tide-700">
            <RotateCcw className="h-2.5 w-2.5" /> Reopen
          </button>
        </div>
      )}
      {/* sub-header: anchor + N of M stepper */}
      <div className="flex items-center gap-2 border-b border-ink-100 px-3.5 py-2 pl-4">
        <span className="font-mono text-[10.5px] text-ink-400">{t.selector === '@page' ? '@page' : t.selector}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => props.onStep(-1)} className="grid h-7 w-7 place-items-center rounded-field text-ink-400 hover:bg-ink-100 hover:text-ink-700"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-[11px] tabular-nums text-ink-400">{props.pos} / {props.total}</span>
          <button onClick={() => props.onStep(1)} className="grid h-7 w-7 place-items-center rounded-field text-ink-400 hover:bg-ink-100 hover:text-ink-700"><ChevronRight className="h-4 w-4" /></button>
          {!t.resolved && (
            <button onClick={props.onResolve} title="Resolve" className="ml-1 grid h-7 w-7 place-items-center rounded-field border border-ink-200 text-ink-400 hover:border-tide-400 hover:text-tide-600"><Check className="h-4 w-4" /></button>
          )}
        </div>
      </div>
      {/* comments */}
      <div className="max-h-[34vh] space-y-3 overflow-y-auto px-3.5 py-3 pl-4">
        {t.comments.map((cm) => (
          <div key={cm.id} className="flex gap-2.5">
            <Avatar name={cm.author_name} size={26} />
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[12px] font-semibold text-ink-800">{cm.author_name}</span>
                {cm.author_sub === VIEWER.sub && <span className="rounded-chip bg-tide-50 px-1 text-[9px] font-bold uppercase text-tide-700">you</span>}
                <span className="text-[10.5px] text-ink-400">{fmtTime(cm.created_at)}</span>
              </div>
              <p className="mt-0.5 text-[12.5px] leading-snug text-ink-700">{cm.text}</p>
            </div>
          </div>
        ))}
      </div>
      {/* tag + reply */}
      {!t.resolved && (
        <div className="border-t border-ink-100 p-2 pl-3">
          <div className="mb-2 flex flex-wrap gap-1">
            {KIND_KEYS.map((k) => {
              const on = t.kind === k;
              return (
                <button key={k} onClick={() => props.onTag(k)} className="flex items-center gap-1 rounded-chip border px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ borderColor: on ? KIND[k].color : '#e7e9eb', background: on ? KIND[k].tint : '#fff', color: on ? KIND[k].ink : '#8a929b' }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: KIND[k].color }} />{KIND[k].label}
                </button>
              );
            })}
          </div>
          <div className="flex items-end gap-1.5">
            <textarea ref={props.replyRef} value={props.replyText} onChange={(e) => props.onReplyChange(e.target.value)} rows={1} placeholder="Reply…"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); props.onReplyCommit(); } }}
              className="max-h-20 min-h-[36px] flex-1 resize-none rounded-field border border-ink-200 bg-ink-50 px-2.5 py-2 text-[12.5px] text-ink-800 outline-none placeholder:text-ink-400 focus:border-tide-400 focus:bg-white" />
            <button onClick={props.onReplyCommit} disabled={!props.replyText.trim()} className="grid h-9 w-9 place-items-center rounded-field bg-tide-600 text-white disabled:bg-ink-200">
              <CornerDownLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- draft card ------------------------------- */
function DraftCard(props: {
  draft: { selector: string; text: string; kind: PpThread['kind'] };
  draftRef: React.RefObject<HTMLTextAreaElement>;
  onChange: (v: string) => void; onTag: (k: PpThread['kind']) => void; onCommit: () => void; onCancel: () => void;
}) {
  const c = props.draft.kind ? KIND[props.draft.kind].color : '#14958a';
  return (
    <div className="tl-anim relative overflow-hidden rounded-card border-2 bg-white" style={{ borderColor: c, boxShadow: '0 12px 30px -12px rgba(17,22,27,.2)', animation: `tl-pop 200ms ${EASE} both` }}>
      <div className="p-3">
        <div className="mb-2 flex items-center gap-2">
          <MessageSquarePlus className="h-4 w-4 text-tide-600" />
          <span className="text-[12.5px] font-bold text-ink-900">New comment</span>
          <span className="ml-auto rounded-chip bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-600">{props.draft.selector === '@page' ? '@page' : props.draft.selector}</span>
        </div>
        <textarea ref={props.draftRef} value={props.draft.text} onChange={(e) => props.onChange(e.target.value)} rows={3} autoFocus placeholder="What needs changing here?"
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') props.onCommit(); if (e.key === 'Escape') props.onCancel(); }}
          className="w-full resize-none rounded-field border border-ink-200 bg-ink-50 p-2.5 text-[13px] leading-relaxed text-ink-800 outline-none placeholder:text-ink-400 focus:border-tide-400 focus:bg-white" />
        <div className="mt-2 flex flex-wrap gap-1">
          {KIND_KEYS.map((k) => {
            const on = props.draft.kind === k;
            return (
              <button key={k} onClick={() => props.onTag(on ? null : k)} className="flex items-center gap-1 rounded-chip border px-2 py-0.5 text-[11px] font-semibold"
                style={{ borderColor: on ? KIND[k].color : '#e7e9eb', background: on ? KIND[k].tint : '#fff', color: on ? KIND[k].ink : '#8a929b' }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: KIND[k].color }} />{KIND[k].label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button onClick={props.onCancel} className="rounded-field px-3 py-1.5 text-[12px] font-semibold text-ink-500 hover:bg-ink-100">Cancel</button>
          <button onClick={props.onCommit} disabled={!props.draft.text.trim()} className="flex items-center gap-1.5 rounded-field bg-tide-600 px-3.5 py-1.5 text-[12px] font-bold text-white disabled:bg-ink-200">
            Comment <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- avatar --------------------------------- */
function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: avatarColor(name), fontSize: size * 0.42 }}>
      {initialOf(name)}
    </span>
  );
}
