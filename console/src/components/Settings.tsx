import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Lock } from 'lucide-react';
import { api } from '../api';
import { formatBytes } from '../lib/format';
import { useStore } from '../store';
import type { Usage } from '../types';
import { PasswordDialog } from './PasswordDialog';
import { toast, toastError } from './Toast';
import { TokenManager } from './TokenManager';

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-ink-200 bg-white p-6 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-ink-800">{title}</h2>
        {sub && <span className="text-xs text-ink-400">{sub}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({
  label,
  desc,
  children,
  last,
}: {
  label: string;
  desc: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 py-3.5 ${last ? '' : 'border-b border-ink-100'}`}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink-700">{label}</div>
        <div className="text-xs text-ink-400">{desc}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function barColor(pct: number): string {
  if (pct > 80) return '#c0392b';
  if (pct > 50) return '#d98a16';
  return '#14958a';
}

export function Settings() {
  const me = useStore((s) => s.me)!;
  const setMe = useStore((s) => s.setMe);
  const [name, setName] = useState(me.display_name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    api
      .usage()
      .then(setUsage)
      .catch((e) => toastError(e, 'Failed to load usage'));
  }, []);

  const dirty = name.trim() !== (me.display_name ?? '');
  const saveName = () => {
    if (!dirty || savingName) return;
    setSavingName(true);
    const value = name.trim();
    api
      .updateProfile(value || null)
      .then((r) => {
        setMe({ ...me, display_name: r.display_name ?? '' });
        toast('Profile saved');
      })
      .catch((e) => toastError(e, 'Save failed'))
      .finally(() => setSavingName(false));
  };

  const limitMb = me.limits.max_site_mb;
  const limitBytes = limitMb * 1024 * 1024;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-ink-200 bg-ink-50/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <span className="font-mono text-lg font-bold tracking-tight text-tide-600">
              page<span className="text-ink-800">pin</span>
            </span>
            <a
              href="/"
              className="flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-tide-700"
            >
              <ArrowLeft className="h-4 w-4" /> Back to sites
            </a>
          </div>
          <div className="text-right leading-tight">
            <div className="text-sm font-semibold text-ink-700">{me.display_name}</div>
            {me.handle && <div className="font-mono text-xs text-ink-400">@{me.handle}</div>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:px-6">
        <h1 className="text-xl font-bold tracking-tight text-ink-900">Account &amp; settings</h1>

        <Card title="Profile">
          <Row label="Handle" desc="Permanent — appears in every share link.">
            {me.handle ? (
              <>
                <span className="font-mono text-sm text-ink-700">@{me.handle}</span>
                <span className="inline-flex items-center gap-1 rounded-chip bg-ink-100 px-2 py-0.5 text-xs text-ink-500">
                  <Lock className="h-3 w-3" /> Locked
                </span>
              </>
            ) : (
              <span className="text-xs text-ink-400">Not set yet</span>
            )}
          </Row>
          <Row label="Display name" desc="Shown in this console only.">
            <input
              className="input !w-48"
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveName()}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={!dirty || savingName}
              onClick={saveName}
            >
              {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </button>
          </Row>
          <Row label="Email" desc="Used for sign-in." last={me.auth_mode !== 'password'}>
            <span className="text-sm text-ink-600">{me.email || '—'}</span>
          </Row>
          {me.auth_mode === 'password' && (
            <Row label="Password" desc="Your sign-in password." last>
              <button type="button" className="btn-ghost" onClick={() => setShowPw(true)}>
                Change password
              </button>
            </Row>
          )}
        </Card>

        <Card title="API tokens" sub="Deploy credentials for agents & CI">
          <TokenManager />
        </Card>

        <Card title="Usage" sub="Against this instance's limits">
          {usage === null ? (
            <div className="flex items-center gap-2 py-2 text-xs text-ink-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="SITES" value={String(usage.sites)} sub="hosted here" />
                <Stat label="STORAGE" value={formatBytes(usage.storage_bytes)} sub="across all versions" />
                <Stat
                  label="PER-SITE LIMIT"
                  value={`${limitMb} MB`}
                  sub={`· ${me.limits.max_files} files · ${me.limits.max_file_mb} MB/file`}
                />
              </div>
              {usage.per_site.length > 0 && (
                <div className="mt-5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                    Per-site storage
                  </div>
                  <div className="mt-2.5 space-y-3">
                    {usage.per_site.map((s) => {
                      const hasLimit = limitBytes > 0;
                      const pct = hasLimit ? (s.total_bytes / limitBytes) * 100 : 0;
                      return (
                        <div key={s.slug}>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="truncate font-mono font-semibold text-ink-700">{s.slug}</span>
                            <span className="shrink-0 text-ink-400">
                              {formatBytes(s.total_bytes)}
                              {hasLimit ? ` / ${limitMb} MB` : ''} · {s.file_count}
                              {me.limits.max_files > 0 ? ` / ${me.limits.max_files}` : ''} files
                            </span>
                          </div>
                          <div className="mt-1.5 h-[7px] overflow-hidden rounded-full bg-ink-100">
                            {hasLimit && (
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.max(2, Math.min(100, pct))}%`,
                                  backgroundColor: barColor(pct),
                                }}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </main>

      {showPw && <PasswordDialog onClose={() => setShowPw(false)} />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-panel bg-ink-50 p-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold text-ink-800">{value}</div>
      <div className="mt-0.5 text-xs text-ink-400">{sub}</div>
    </div>
  );
}
