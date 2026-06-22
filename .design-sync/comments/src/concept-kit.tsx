/**
 * Shared building blocks for the three comment-redesign concepts: a local thread
 * store with working actions (reply / kind / resolve / create) and a hook that
 * tracks the viewport rects of anchored page elements (for positioning overlays).
 * Keeps each concept focused on its own interaction model.
 */
import { useEffect, useState } from 'react';
import {
  KIND,
  KIND_KEYS,
  PATH,
  VIEWER,
  avatarColor,
  fmtTime,
  initialOf,
  makeThreads,
  type PpThread,
} from './comment-fixtures';

export { KIND, KIND_KEYS, VIEWER, avatarColor, fmtTime, initialOf, type PpThread };
export type { PpComment } from './comment-fixtures';

export const rid = () => 'x' + Math.random().toString(36).slice(2, 10);
export const newComment = (text: string) => ({
  id: rid(),
  author_sub: VIEWER.sub,
  author_name: VIEWER.name,
  text,
  created_at: new Date().toISOString(),
});

/** Local thread store + actions; every concept mutates its own copy. */
export function useThreads() {
  const [threads, setThreads] = useState<PpThread[]>(() => makeThreads());

  const addReply = (id: string, text: string) =>
    setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, comments: [...t.comments, newComment(text)] } : t)));

  const setKind = (id: string, kind: PpThread['kind']) =>
    setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, kind } : t)));

  const toggleResolve = (id: string) =>
    setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, resolved: !t.resolved } : t)));

  const create = (selector: string, text: string, kind: PpThread['kind'] = null) => {
    const t: PpThread = {
      id: rid(),
      selector,
      rx: 0.5,
      ry: 0.5,
      rw: null,
      rh: null,
      kind,
      resolved: false,
      page_path: PATH,
      comments: [newComment(text)],
    };
    setThreads((ts) => [...ts, t]);
    return t;
  };

  return { threads, setThreads, addReply, setKind, toggleResolve, create };
}

/** Track viewport rects of anchored elements within a scroll container. Recomputes
 *  on scroll/resize and briefly polls so it settles after fonts/layout. */
export function useAnchorRects(
  container: HTMLElement | null,
  selectors: string[],
): Record<string, DOMRect> {
  const [rects, setRects] = useState<Record<string, DOMRect>>({});
  const key = selectors.join('|');
  useEffect(() => {
    if (!container) return;
    const compute = () => {
      const next: Record<string, DOMRect> = {};
      for (const sel of selectors) {
        if (sel === '@page') continue;
        const elx = container.querySelector(sel);
        if (elx) next[sel] = elx.getBoundingClientRect();
      }
      setRects(next);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(container);
    container.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    const ticks = [60, 180, 400, 800].map((d) => setTimeout(compute, d));
    return () => {
      ro.disconnect();
      container.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
      ticks.forEach(clearTimeout);
    };
  }, [container, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return rects;
}
