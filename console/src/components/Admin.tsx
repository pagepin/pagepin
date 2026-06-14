import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Database,
  HardDrive,
  Loader2,
  Mail,
  Plus,
  Shield,
  Users as UsersIcon,
} from 'lucide-react';
import { api } from '../api';
import { confirmDanger } from './ConfirmDialog';
import { copyText, formatBytes, formatRelative } from '../lib/format';
import { useStore } from '../store';
import type {
  AdminOverview,
  AdminSettings,
  AdminUser,
  Invite,
  InviteCreated,
  RegistrationMode,
} from '../types';
import { toast, toastError } from './Toast';

const REG_MODES: { key: RegistrationMode; label: string; desc: string }[] = [
  { key: 'closed', label: 'Closed', desc: 'No new accounts. Existing users only.' },
  { key: 'invite', label: 'Invite-only', desc: 'Join only via a one-time invite link you generate.' },
  { key: 'open', label: 'Open', desc: 'Anyone with the URL can self-register. Best for trusted networks.' },
];

const AVA = ['#0b6358', '#1f4f86', '#8a560b', '#5b3596', '#b14a42'];
function avatarColor(handle: string | null, disabled: boolean): string {
  if (disabled) return '#b3b9bf';
  const s = handle ?? '?';
  let n = 0;
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i);
  return AVA[n % AVA.length];
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-card border border-ink-200 bg-white p-6 shadow-card">{children}</section>;
}

function StatCard({
  icon,
  label,
  value,
  sub,
  tint,
  ink,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tint: string;
  ink: string;
}) {
  return (
    <div className="rounded-card border border-ink-200 bg-white p-4 shadow-card">
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-chip"
          style={{ backgroundColor: tint, color: ink }}
        >
          {icon}
        </span>
        <span className="text-xs font-semibold text-ink-500">{label}</span>
      </div>
      <div className="mt-2 font-mono text-2xl font-bold text-ink-800">{value}</div>
      <div className="mt-0.5 text-xs text-ink-400">{sub}</div>
    </div>
  );
}

function RolePill({ u }: { u: AdminUser }) {
  if (u.disabled)
    return (
      <span className="rounded-chip border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
        disabled
      </span>
    );
  if (u.is_admin)
    return (
      <span className="rounded-chip border border-tide-200 bg-tide-50 px-2 py-0.5 text-xs font-medium text-tide-700">
        admin
      </span>
    );
  return (
    <span className="rounded-chip border border-ink-200 bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-500">
      member
    </span>
  );
}

export function Admin() {
  const me = useStore((s) => s.me)!;
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteAdmin, setInviteAdmin] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<InviteCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.adminOverview().then(setOverview).catch((e) => toastError(e, 'Failed to load overview'));
    api.adminSettings().then(setSettings).catch((e) => toastError(e, 'Failed to load settings'));
    api.adminUsers().then((r) => setUsers(r.users)).catch((e) => toastError(e, 'Failed to load users'));
    api.listInvites().then((r) => setInvites(r.invites)).catch(() => {});
  }, []);

  const isPassword = settings?.auth_mode === 'password';
  const regMode = settings?.registration_mode ?? 'closed';
  const locked = settings?.registration_locked ?? false;

  const changeMode = (mode: RegistrationMode) => {
    if (locked || mode === regMode || !settings) return;
    api
      .setRegistrationMode(mode)
      .then(() => {
        setSettings({ ...settings, registration_mode: mode });
        toast(`Registration: ${mode}`);
      })
      .catch((e) => toastError(e, 'Could not change mode'));
  };

  const generate = () => {
    if (generating) return;
    setGenerating(true);
    setGenerated(null);
    setCopied(false);
    const body: { email?: string; is_admin?: boolean } = {};
    if (inviteEmail.trim()) body.email = inviteEmail.trim();
    if (inviteAdmin) body.is_admin = true;
    api
      .createInvite(body)
      .then((inv) => {
        setGenerated(inv);
        setInviteEmail('');
        setInviteAdmin(false);
        api.listInvites().then((r) => setInvites(r.invites)).catch(() => {});
      })
      .catch((e) => toastError(e, 'Could not create invite'))
      .finally(() => setGenerating(false));
  };

  const revokeInvite = async (inv: Invite) => {
    const ok = await confirmDanger({
      title: 'Revoke invite?',
      body: `The link${inv.email ? ` for ${inv.email}` : ''} stops working immediately.`,
      confirmText: 'Revoke',
    });
    if (!ok) return;
    api
      .revokeInvite(inv.id)
      .then(() => {
        setInvites((prev) => prev.filter((x) => x.id !== inv.id));
        toast('Invite revoked');
      })
      .catch((e) => toastError(e, 'Revoke failed'));
  };

  const patchUser = (u: AdminUser, body: { is_admin?: boolean; disabled?: boolean }, label: string) => {
    setBusy(u.id);
    api
      .patchUser(u.id, body)
      .then((updated) => {
        setUsers((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)));
        toast(label);
      })
      .catch((e) => toastError(e, 'Update failed'))
      .finally(() => setBusy(null));
  };

  const toggleDisabled = async (u: AdminUser) => {
    if (!u.disabled) {
      const ok = await confirmDanger({
        title: `Disable ${u.handle ? '@' + u.handle : (u.email ?? 'this user')}?`,
        body: 'They lose access immediately — across the console, private pages and the comment layer.',
        confirmText: 'Disable',
      });
      if (!ok) return;
    }
    patchUser(u, { disabled: !u.disabled }, u.disabled ? 'User re-enabled' : 'User disabled');
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-ink-200 bg-ink-50/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <span className="font-mono text-lg font-bold tracking-tight text-tide-600">
              page<span className="text-ink-800">pin</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-chip bg-ink-900 px-2 py-0.5 text-xs font-semibold text-white">
              <Shield className="h-3 w-3" /> Admin
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

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900">Instance admin</h1>
          <p className="mt-1 text-sm text-ink-500">
            Manage who can sign in and keep an eye on what&apos;s stored. Only admins see this.
          </p>
        </div>

        {/* Overview */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={<Database className="h-4 w-4" />}
            label="Sites"
            value={overview ? String(overview.sites) : '—'}
            sub="across all users"
            tint="#e6f4f2"
            ink="#0b6358"
          />
          <StatCard
            icon={<UsersIcon className="h-4 w-4" />}
            label="Users"
            value={overview ? String(overview.users) : '—'}
            sub={overview ? `${overview.admins} admin${overview.admins === 1 ? '' : 's'}` : ' '}
            tint="#e8f0f9"
            ink="#1f4f86"
          />
          <StatCard
            icon={<HardDrive className="h-4 w-4" />}
            label="Storage"
            value={overview ? formatBytes(overview.storage_bytes) : '—'}
            sub="across all sites"
            tint="#faf0db"
            ink="#8a560b"
          />
          <StatCard
            icon={<Database className="h-4 w-4" />}
            label="Versions"
            value={overview ? String(overview.versions) : '—'}
            sub="immutable deploys"
            tint="#f0eafb"
            ink="#5b3596"
          />
        </div>

        {/* Registration & invites */}
        <Card>
          <h2 className="text-sm font-bold text-ink-800">Registration</h2>
          {!isPassword ? (
            <p className="mt-3 text-xs text-ink-400">
              This instance uses{' '}
              <span className="font-mono">{settings?.auth_mode ?? '…'}</span> sign-in; registration
              mode and invites apply to password mode only.
            </p>
          ) : (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {REG_MODES.map((m) => {
                  const active = regMode === m.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      disabled={locked}
                      onClick={() => changeMode(m.key)}
                      className={`rounded-panel border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        active
                          ? 'border-tide-300 bg-tide-50 ring-1 ring-tide-200'
                          : 'border-ink-200 bg-white hover:border-tide-200'
                      }`}
                    >
                      <div
                        className={`text-sm font-semibold ${active ? 'text-tide-700' : 'text-ink-700'}`}
                      >
                        {m.label}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-400">{m.desc}</div>
                    </button>
                  );
                })}
              </div>
              {locked && (
                <p className="mt-2 text-xs text-ink-400">
                  Locked by <span className="font-mono">PAGEPIN_REGISTRATION_MODE</span> — unset it
                  to change here.
                </p>
              )}

              {regMode !== 'closed' && (
                <div className="mt-5 rounded-panel border border-ink-200 bg-ink-50 p-4">
                  <div className="flex items-center gap-2 text-ink-700">
                    <Mail className="h-4 w-4 text-tide-600" />
                    <span className="text-sm font-semibold">Invite a user</span>
                    <span className="text-xs text-ink-400">· one-time link, expires soon</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      className="input !w-56"
                      type="email"
                      placeholder="teammate@email.com (optional)"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && generate()}
                    />
                    <label className="flex items-center gap-1.5 text-xs text-ink-500">
                      <input
                        type="checkbox"
                        checked={inviteAdmin}
                        onChange={(e) => setInviteAdmin(e.target.checked)}
                      />
                      as admin
                    </label>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={generating}
                      onClick={generate}
                    >
                      {generating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      Generate link
                    </button>
                  </div>

                  {generated && (
                    <div className="mt-3 rounded-field border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs text-amber-800">
                        Copy it now — shown only once.
                        {generated.email ? ` Send it to ${generated.email}; ` : ' '}works a single
                        time.
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-ink-900 px-2.5 py-1.5 font-mono text-xs text-tide-200">
                          {generated.url}
                        </code>
                        <button
                          type="button"
                          className="btn-ghost shrink-0"
                          onClick={() =>
                            void copyText(generated.url).then((ok) => {
                              setCopied(ok);
                              if (ok) window.setTimeout(() => setCopied(false), 1500);
                              toast(ok ? 'Invite link copied' : 'Copy failed', ok ? 'ok' : 'err');
                            })
                          }
                        >
                          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          Copy
                        </button>
                      </div>
                    </div>
                  )}

                  {invites.length > 0 && (
                    <div className="mt-4 border-t border-ink-200 pt-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                        Invite links
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {invites.map((inv) => (
                          <div key={inv.id} className="flex items-center justify-between gap-2 text-xs">
                            <span className="truncate font-mono text-ink-600">
                              {inv.email ?? '(any email)'}
                              {inv.is_admin && <span className="ml-1 text-tide-600">· admin</span>}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className={inv.expired ? 'text-red-500' : 'text-ink-400'}>
                                {inv.expired ? 'expired' : `expires ${formatRelative(inv.expires_at)}`}
                              </span>
                              <button
                                type="button"
                                className="text-red-500 hover:text-red-600 hover:underline"
                                onClick={() => void revokeInvite(inv)}
                              >
                                Revoke
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </Card>

        {/* Users */}
        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-ink-800">Users</h2>
            <span className="text-xs text-ink-400">{users ? `${users.length} total` : ''}</span>
          </div>
          <div className="mt-3 divide-y divide-ink-100 border-t border-ink-100">
            {users === null ? (
              <div className="flex items-center gap-2 py-4 text-xs text-ink-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            ) : (
              users.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                    style={{ backgroundColor: avatarColor(u.handle, u.disabled) }}
                  >
                    {(u.handle ?? u.email ?? '?').replace(/^@/, '').charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`truncate font-mono text-sm font-semibold ${u.disabled ? 'text-ink-400' : 'text-ink-700'}`}
                      >
                        {u.handle ? `@${u.handle}` : '(no handle)'}
                      </span>
                      <RolePill u={u} />
                      {u.id === me.sub && <span className="text-[11px] text-ink-400">you</span>}
                    </div>
                    <div className="truncate text-xs text-ink-400">{u.email ?? '—'}</div>
                  </div>
                  <div className="hidden text-right text-xs text-ink-400 sm:block">
                    <div>
                      {u.site_count} site{u.site_count === 1 ? '' : 's'} · {formatBytes(u.storage_bytes)}
                    </div>
                    <div>{u.last_login_at ? `active ${formatRelative(u.last_login_at)}` : 'never'}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {busy === u.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-400" />}
                    <button
                      type="button"
                      className="rounded-chip px-2 py-1 text-xs text-ink-500 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-40 disabled:hover:bg-transparent"
                      disabled={busy === u.id || u.id === me.sub}
                      title={u.id === me.sub ? "You can't change your own role here" : undefined}
                      onClick={() =>
                        patchUser(
                          u,
                          { is_admin: !u.is_admin },
                          u.is_admin ? 'Admin removed' : 'Promoted to admin',
                        )
                      }
                    >
                      {u.is_admin ? 'Remove admin' : 'Make admin'}
                    </button>
                    <button
                      type="button"
                      className={`rounded-chip px-2 py-1 text-xs disabled:opacity-40 disabled:hover:bg-transparent ${
                        u.disabled
                          ? 'text-tide-600 hover:bg-tide-50'
                          : 'text-red-500 hover:bg-red-50 hover:text-red-600'
                      }`}
                      disabled={busy === u.id || u.id === me.sub}
                      title={u.id === me.sub ? "You can't change your own access here" : undefined}
                      onClick={() => void toggleDisabled(u)}
                    >
                      {u.disabled ? 'Enable' : 'Disable'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Instance limits (read-only) */}
        {settings && (
          <Card>
            <h2 className="text-sm font-bold text-ink-800">Instance limits</h2>
            <p className="mt-1 text-xs text-ink-400">Set via environment variables at boot.</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Limit name="PAGEPIN_MAX_SITE_MB" value={`${settings.limits.max_site_mb} MB`} />
              <Limit name="PAGEPIN_MAX_FILE_MB" value={`${settings.limits.max_file_mb} MB`} />
              <Limit name="PAGEPIN_MAX_FILES" value={String(settings.limits.max_files)} />
              <Limit name="PAGEPIN_PUBLIC_MAX_HOURS" value={`${settings.limits.public_max_hours} h`} />
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}

function Limit({ name, value }: { name: string; value: string }) {
  return (
    <div className="rounded-panel bg-ink-50 p-3">
      <div className="font-mono text-[11px] text-ink-400">{name}</div>
      <div className="mt-0.5 text-sm font-semibold text-ink-700">{value}</div>
    </div>
  );
}
