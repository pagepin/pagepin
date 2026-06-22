/**
 * design-sync v1 bundle entry — prop-free, mock-backed wrappers around the REAL
 * console screens, re-exported for window.Pagepin.*. Compiled by prebundle.mjs
 * (which aliases ../store→mock-store, ../api→mock-api and rewrites `location`→__ppLoc).
 *
 * Each export renders a real screen populated by fixtures and stays interactive.
 * ConsolePrototype renders the real <App/> and routes in-app via the location shim.
 */
import { useEffect, useLayoutEffect, useReducer, useState } from 'react';

import App from '../../../console/src/App';
import { Login } from '../../../console/src/components/Login';
import { Signup } from '../../../console/src/components/Signup';
import { AcceptInvite } from '../../../console/src/components/AcceptInvite';
import { Activate } from '../../../console/src/components/Activate';
import { HandleSetup } from '../../../console/src/components/HandleSetup';
import { TopBar } from '../../../console/src/components/TopBar';
import { DropZone } from '../../../console/src/components/DropZone';
import { SiteList } from '../../../console/src/components/SiteList';
import { SiteCard } from '../../../console/src/components/SiteCard';
import { Settings } from '../../../console/src/components/Settings';
import { Admin } from '../../../console/src/components/Admin';
import { TokenManager } from '../../../console/src/components/TokenManager';
import { TokenDialog } from '../../../console/src/components/TokenDialog';
import { PasswordDialog } from '../../../console/src/components/PasswordDialog';
import { Toaster } from '../../../console/src/components/Toast';
import { Confirmer } from '../../../console/src/components/ConfirmDialog';

import { useStore } from './mock-store';
import { DEVICE_USER_CODE, ME, SITES } from './fixtures';

/**
 * Global, capture-phase guard: turn same-origin anchor clicks (Settings/Admin
 * "back to /", etc.) into in-app routing via the location shim instead of a real
 * iframe navigation. Harmless in single-screen cards (the ppnav event has no
 * listener there — the click is simply swallowed, never blanking the card).
 */
if (typeof document !== 'undefined' && !(globalThis as Record<string, unknown>).__ppNavGuard) {
  (globalThis as Record<string, unknown>).__ppNavGuard = true;
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target as Element | null;
      const a = el && 'closest' in el ? el.closest('a') : null;
      const href = a?.getAttribute('href');
      if (href && href.startsWith('/') && !href.startsWith('//')) {
        e.preventDefault();
        location.href = href;
      }
    },
    true,
  );
}

/** App-shell chrome shared by the authenticated single-screen cards. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      {children}
      <Toaster />
      <Confirmer />
    </div>
  );
}

// ---- pre-auth screens ----
export function LoginScreen() {
  return <Login />;
}

export function SignupScreen() {
  return <Signup />;
}

export function AcceptInviteScreen() {
  return <AcceptInvite token="inv_demo_token" />;
}

export function ActivateScreen() {
  // Activate reads ?user_code from location (the shim); seed it before it renders.
  useState(() => {
    location.search = '?user_code=' + DEVICE_USER_CODE;
    return 0;
  });
  return (
    <Shell>
      <Activate />
    </Shell>
  );
}

export function HandleSetupScreen() {
  // First-login state: no handle yet, needs_handle true.
  useLayoutEffect(() => {
    useStore.setState({ me: { ...ME, handle: null, needs_handle: true } });
  }, []);
  return (
    <Shell>
      <TopBar />
      <HandleSetup />
    </Shell>
  );
}

// ---- authenticated screens ----
export function SitesScreen() {
  return (
    <Shell>
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <DropZone />
        <SiteList />
      </main>
      <footer className="pb-8 pt-4 text-center text-xs text-ink-300">
        pagepin · static hosting with built-in review
      </footer>
    </Shell>
  );
}

export function SiteCardScreen() {
  const [expanded, setExpanded] = useState(true);
  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <SiteCard
          site={SITES[0]}
          now={Date.now()}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
        />
      </div>
    </Shell>
  );
}

export function SettingsScreen() {
  return (
    <Shell>
      <Settings />
    </Shell>
  );
}

export function AdminScreen() {
  return (
    <Shell>
      <Admin />
    </Shell>
  );
}

export function TokenManagerScreen() {
  return (
    <Shell>
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-card border border-ink-200 bg-white p-5 shadow-card">
          <TokenManager />
        </div>
      </div>
    </Shell>
  );
}

export function TokenDialogScreen() {
  return (
    <Shell>
      <TokenDialog onClose={() => {}} />
    </Shell>
  );
}

export function PasswordDialogScreen() {
  return (
    <Shell>
      <PasswordDialog onClose={() => {}} />
    </Shell>
  );
}

// ---- full interactive prototype ----
export function ConsolePrototype() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const onNav = () => force();
    window.addEventListener('ppnav', onNav);
    return () => window.removeEventListener('ppnav', onNav);
  }, []);
  return <App />;
}
