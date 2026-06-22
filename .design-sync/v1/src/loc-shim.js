/**
 * Controllable stand-in for the global `location`, wired via esbuild:
 *   define:  { location: '__ppLoc' }   // rewrite every bare `location.*` reference
 *   inject:  [ this file ]             // provide the `__ppLoc` export wherever it now appears
 *
 * Real console code reads location.pathname / location.search / location.origin
 * and assigns location.href to navigate. Inside a claude.ai/design preview
 * iframe a real navigation would blank the card, so this shim:
 *   - serves a controllable pathname/search (set by wrappers, e.g. Activate),
 *   - turns href/assign/replace into in-app routing via a `ppnav` window event
 *     (ConsolePrototype listens and re-renders the real <App/> against the new path),
 *   - makes reload() a no-op.
 *
 * Only MY pre-bundle gets this define (react/react-dom are external and untouched),
 * so it never interferes with framework internals.
 */
export const __ppLoc = {
  _path: '/',
  _search: '',
  origin: 'https://app.pagepin.ai',
  host: 'app.pagepin.ai',
  hostname: 'app.pagepin.ai',
  protocol: 'https:',
  hash: '',
  get pathname() {
    return this._path;
  },
  set pathname(v) {
    this._path = v || '/';
  },
  get search() {
    return this._search;
  },
  set search(v) {
    this._search = !v ? '' : v.startsWith('?') ? v : '?' + v;
  },
  get href() {
    return this.origin + this._path + this._search;
  },
  set href(v) {
    let path = String(v);
    let search = '';
    try {
      if (/^https?:\/\//i.test(path)) {
        const u = new URL(path);
        path = u.pathname;
        search = u.search;
      }
    } catch {
      /* fall through with raw path */
    }
    const qi = path.indexOf('?');
    if (qi !== -1) {
      search = path.slice(qi);
      path = path.slice(0, qi);
    }
    this._path = path || '/';
    this._search = search;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ppnav', { detail: this._path }));
    }
  },
  assign(v) {
    this.href = v;
  },
  replace(v) {
    this.href = v;
  },
  reload() {
    /* no-op in preview */
  },
  toString() {
    return this.href;
  },
};
