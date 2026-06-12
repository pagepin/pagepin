import { create } from 'zustand';
import { api, ApiError, fetchAuthConfig } from './api';
import type { Me, SiteOut } from './types';

interface AppState {
  me: Me | null;
  sites: SiteOut[];
  booting: boolean;
  bootError: string | null;
  loadingSites: boolean;
  /** 「更新部署」锁定的目标 slug；DropZone 监听它 */
  deployTarget: string | null;

  init: () => Promise<void>;
  refreshSites: () => Promise<void>;
  setMe: (me: Me) => void;
  setDeployTarget: (slug: string | null) => void;
  upsertSite: (site: SiteOut) => void;
  removeSite: (slug: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  me: null,
  sites: [],
  booting: true,
  bootError: null,
  loadingSites: false,
  deployTarget: null,

  init: async () => {
    // 先暖认证配置缓存（永不抛错，失败有 oidc 兜底），
    // 这样 me() 401 时 api 层的 redirectToLogin 能按模式分流：
    // password → /login（SPA 内 Login 页），oidc/none → /auth/login。
    await fetchAuthConfig();
    try {
      const me = await api.me();
      set({ me, booting: false });
      if (!me.needs_handle) await get().refreshSites();
    } catch (e) {
      // 401 已在 api 层按 auth 模式跳转登录页；这里只处理其他错误
      if (e instanceof ApiError && e.status === 401) return;
      set({ booting: false, bootError: e instanceof Error ? e.message : '加载失败' });
    }
  },

  refreshSites: async () => {
    set({ loadingSites: true });
    try {
      const { sites } = await api.listSites();
      set({ sites });
    } finally {
      set({ loadingSites: false });
    }
  },

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
