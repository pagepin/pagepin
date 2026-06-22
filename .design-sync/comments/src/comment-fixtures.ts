/**
 * Mock viewer + comment threads for the comment-overlay design bundle.
 * Shared by the real-overlay baseline (fed through a stubbed fetch) and by the
 * three redesign concepts (read directly). Selectors match element ids in
 * review-page.tsx so pins/anchors resolve.
 */
export interface PpComment {
  id: string;
  author_sub: string;
  author_name: string;
  text: string;
  created_at: string;
}

export interface PpThread {
  id: string;
  selector: string; // CSS selector or "@page"
  rx: number; // 0..1 anchor offset inside the element box
  ry: number;
  rw: number | null; // region width (0..1) or null for a point
  rh: number | null;
  kind: 'copy' | 'style' | 'question' | 'bug' | null;
  resolved: boolean;
  page_path: string;
  anchor_text?: string | null;
  comments: PpComment[];
}

export const HANDLE = 'wenqi';
export const SLUG = 'orbit-launch';
export const PATH = 'index.html';

/** The signed-in reviewer. comments.js only reads `.sub` (to mark "mine"). */
export const VIEWER = { sub: 'u_wenqi', name: 'Wenqi Zhang' };

/** Review-feedback kinds — the shared colour language (mirrors comments.js KIND). */
export const KIND = {
  copy: { label: 'Copy', color: '#2f6fb0', tint: '#e8f0f9', ink: '#1f4f86' },
  style: { label: 'Style', color: '#c07a16', tint: '#faf0db', ink: '#8a560b' },
  question: { label: 'Question', color: '#7c4bc0', tint: '#f0eafb', ink: '#5b3596' },
  bug: { label: 'Bug', color: '#c2361b', tint: '#fbe7e3', ink: '#94260f' },
} as const;
export const KIND_KEYS = ['copy', 'style', 'question', 'bug'] as const;

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Fresh mutable thread set per consumer (each concept/card mutates its own). */
export function makeThreads(): PpThread[] {
  return [
    {
      id: 'th_hero_copy',
      selector: '#hero-title',
      rx: 0.5,
      ry: 0.5,
      rw: null,
      rh: null,
      kind: 'copy',
      resolved: false,
      page_path: PATH,
      comments: [
        {
          id: 'c1',
          author_sub: 'u_mia',
          author_name: 'Mia Chen',
          text: "Can we make this headline punchier? “Analytics” feels generic — what's the one outcome a team gets?",
          created_at: ago(3 * HOUR),
        },
      ],
    },
    {
      id: 'th_cta_style',
      selector: '#hero-cta',
      rx: 0.5,
      ry: 0.5,
      rw: null,
      rh: null,
      kind: 'style',
      resolved: false,
      page_path: PATH,
      comments: [
        {
          id: 'c2',
          author_sub: 'u_wenqi',
          author_name: 'Wenqi Zhang',
          text: 'The button reads a little low-contrast on this teal. Bump it to tide-700?',
          created_at: ago(2 * HOUR),
        },
        {
          id: 'c3',
          author_sub: 'u_mia',
          author_name: 'Mia Chen',
          text: 'Agree — darker green + a touch more padding would help it feel clickable.',
          created_at: ago(95 * MIN),
        },
      ],
    },
    {
      id: 'th_feature_q',
      selector: '#feature-2',
      rx: 0.5,
      ry: 0.32,
      rw: null,
      rh: null,
      kind: 'question',
      resolved: false,
      page_path: PATH,
      comments: [
        {
          id: 'c4',
          author_sub: 'u_ops',
          author_name: 'Ops Bot',
          text: 'Is this number live or a sampled estimate? Worth a tooltip if it updates in real time.',
          created_at: ago(40 * MIN),
        },
      ],
    },
    {
      id: 'th_pricing_bug',
      selector: '#pricing',
      rx: 0.5,
      ry: 0.5,
      rw: null,
      rh: null,
      kind: 'bug',
      resolved: true,
      page_path: PATH,
      comments: [
        {
          id: 'c5',
          author_sub: 'u_mia',
          author_name: 'Mia Chen',
          text: "Typo: “montly” → “monthly”.",
          created_at: ago(5 * HOUR),
        },
      ],
    },
    {
      id: 'th_page_note',
      selector: '@page',
      rx: 0,
      ry: 0,
      rw: null,
      rh: null,
      kind: null,
      resolved: false,
      page_path: PATH,
      comments: [
        {
          id: 'c6',
          author_sub: 'u_wenqi',
          author_name: 'Wenqi Zhang',
          text: 'Overall this is a strong direction — just tighten the vertical rhythm between sections.',
          created_at: ago(20 * MIN),
        },
      ],
    },
  ];
}

export const fmtTime = (iso: string): string => {
  const d = new Date(iso).getTime();
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

export const initialOf = (name: string) => (name || '?').trim().slice(0, 1).toUpperCase();
const AVA = ['#2f6fb0', '#0f7c72', '#7c4bc0', '#c07a16', '#b14a42'];
export const avatarColor = (name: string) =>
  AVA[[...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVA.length];
