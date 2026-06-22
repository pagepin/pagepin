/**
 * Mock of console/src/store.ts — a REAL zustand store (so reactivity works) with
 * the identical AppState interface, pre-seeded with fixtures and working actions.
 * esbuild aliases `../store` / `./store` in the real components to this module, so
 * they render populated and stay interactive (upsert/remove/setMe mutate live state).
 */
import { create } from 'zustand';
import type { Me, SiteOut } from '../../../console/src/types';
import { ME, SITES } from './fixtures';

interface AppState {
  me: Me | null;
  sites: SiteOut[];
  booting: boolean;
  bootError: string | null;
  loadingSites: boolean;
  deployTarget: string | null;
  init: () => Promise<void>;
  refreshSites: () => Promise<void>;
  setMe: (me: Me) => void;
  setDeployTarget: (slug: string | null) => void;
  upsertSite: (site: SiteOut) => void;
  removeSite: (slug: string) => void;
}

export const useStore = create<AppState>((set) => ({
  me: ME,
  sites: SITES,
  booting: false,
  bootError: null,
  loadingSites: false,
  deployTarget: null,

  // Boot is already "done" — the screens render seeded data immediately.
  init: async () => {},
  refreshSites: async () => {},

  setMe: (me) => set({ me }),
  setDeployTarget: (slug) => set({ deployTarget: slug }),

  upsertSite: (site) =>
    set((s) => {
      const idx = s.sites.findIndex((x) => x.slug === site.slug);
      if (idx === -1) return { sites: [site, ...s.sites] };
      const next = s.sites.slice();
      next[idx] = site;
      return { sites: next };
    }),

  removeSite: (slug) => set((s) => ({ sites: s.sites.filter((x) => x.slug !== slug) })),
}));
