import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Check,
  Copy,
  Database,
  ExternalLink,
  Globe2,
  HardDrive,
  Loader2,
  Lock,
  Mail,
  Plus,
  RotateCcw,
  Shield,
  Trash2,
  Users as UsersIcon,
} from 'lucide-react';
import { api } from '../api';
import { confirmDanger, confirmWithReason } from './ConfirmDialog';
import { LanguageSwitcher } from './LanguageSwitcher';
import { copyText, formatBytes, formatRelative } from '../lib/format';
import { useT } from '../i18n';
import { useStore } from '../store';
import type {
  AdminOverview,
  AdminSettings,
  AdminSite,
  AdminUser,
  Invite,
  InviteCreated,
  RegistrationMode,
} from '../types';
import { toast, toastError } from './Toast';

const REG_MODES: { key: RegistrationMode; labelKey: string; descKey: string }[] = [
  { key: 'closed', labelKey: 'admin.reg.closed.label', descKey: 'admin.reg.closed.desc' },
  { key: 'invite', labelKey: 'admin.reg.invite.label', descKey: 'admin.reg.invite.desc' },
  { key: 'open', labelKey: 'admin.reg.open.label', descKey: 'admin.reg.open.desc' },
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
  return (
    <section className="rounded-card border border-ink-200 bg-white p-6 shadow-card">
      {children}
    </section>
  );
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
  const t = useT();
  if (u.disabled)
    return (
      <span className="rounded-chip border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
        {t('admin.role.disabled')}
      </span>
    );
  if (u.is_admin)
    return (
      <span className="rounded-chip border border-tide-200 bg-tide-50 px-2 py-0.5 text-xs font-medium text-tide-700">
        {t('admin.role.admin')}
      </span>
    );
  return (
    <span className="rounded-chip border border-ink-200 bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-500">
      {t('admin.role.member')}
    </span>
  );
}

export function Admin() {
  const t = useT();
  const me = useStore((s) => s.me)!;
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [sites, setSites] = useState<AdminSite[] | null>(null);
  const [busySite, setBusySite] = useState<string | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteAdmin, setInviteAdmin] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<InviteCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminOverview()
      .then(setOverview)
      .catch((e) => toastError(e, t('admin.load.overview')));
    api
      .adminSettings()
      .then(setSettings)
      .catch((e) => toastError(e, t('admin.load.settings')));
    api
      .adminUsers()
      .then((r) => setUsers(r.users))
      .catch((e) => toastError(e, t('admin.load.users')));
    api
      .adminSites()
      .then((r) => setSites(r.sites))
      .catch((e) => toastError(e, t('admin.load.sites')));
    api
      .listInvites()
      .then((r) => setInvites(r.invites))
      .catch(() => {});
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
        toast(t('admin.reg.changed', { mode }));
      })
      .catch((e) => toastError(e, t('admin.reg.changeFailed')));
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
        api
          .listInvites()
          .then((r) => setInvites(r.invites))
          .catch(() => {});
      })
      .catch((e) => toastError(e, t('admin.invite.createFailed')))
      .finally(() => setGenerating(false));
  };

  const revokeInvite = async (inv: Invite) => {
    const target = inv.email ? t('admin.invite.revokeFor', { email: inv.email }) : '';
    const ok = await confirmDanger({
      title: t('admin.invite.revokeTitle'),
      body: t('admin.invite.revokeBody', { target }),
      confirmText: t('admin.invite.revoke'),
    });
    if (!ok) return;
    api
      .revokeInvite(inv.id)
      .then(() => {
        setInvites((prev) => prev.filter((x) => x.id !== inv.id));
        toast(t('admin.invite.revoked'));
      })
      .catch((e) => toastError(e, t('admin.invite.revokeFailed')));
  };

  const patchUser = (
    u: AdminUser,
    body: { is_admin?: boolean; disabled?: boolean },
    label: string,
  ) => {
    setBusy(u.id);
    api
      .patchUser(u.id, body)
      .then((updated) => {
        setUsers((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)));
        toast(label);
      })
      .catch((e) => toastError(e, t('admin.user.updateFailed')))
      .finally(() => setBusy(null));
  };

  // 救援:邮箱退信/死域等无法自助验证时,管理员手动标记已验证(否则被门槛挡住不能建站)。
  const verifyUser = (u: AdminUser) => {
    setBusy(u.id);
    api
      .verifyUserEmail(u.id)
      .then(() => {
        setUsers((prev) =>
          (prev ?? []).map((x) => (x.id === u.id ? { ...x, email_verified: true } : x)),
        );
        toast(t('admin.user.emailVerified'));
      })
      .catch((e) => toastError(e, t('admin.user.verifyFailed')))
      .finally(() => setBusy(null));
  };

  const toggleDisabled = async (u: AdminUser) => {
    if (!u.disabled) {
      const target = u.handle ? '@' + u.handle : (u.email ?? t('admin.user.thisUser'));
      const ok = await confirmDanger({
        title: t('admin.user.disableTitle', { target }),
        body: t('admin.user.disableBody'),
        confirmText: t('admin.user.disableConfirm'),
      });
      if (!ok) return;
    }
    patchUser(
      u,
      { disabled: !u.disabled },
      u.disabled ? t('admin.user.reEnabled') : t('admin.user.disabled'),
    );
  };

  const replaceSite = (u: AdminSite) =>
    setSites((prev) => (prev ?? []).map((x) => (x.id === u.id ? u : x)));

  const suspendSite = async (s: AdminSite) => {
    const { ok, reason } = await confirmWithReason({
      title: t('admin.site.disableTitle', { slug: s.slug }),
      body: t('admin.site.disableBody'),
      confirmText: t('admin.site.disableConfirm'),
      label: t('admin.site.disableReasonLabel'),
      placeholder: t('admin.site.disableReasonPlaceholder'),
    });
    if (!ok) return;
    setBusySite(s.id);
    api
      .suspendSite(s.id, reason || undefined)
      .then((u) => {
        replaceSite(u);
        toast(t('admin.site.disabled'));
      })
      .catch((e) => toastError(e, t('admin.site.disableFailed')))
      .finally(() => setBusySite(null));
  };

  const unsuspendSite = (s: AdminSite) => {
    setBusySite(s.id);
    api
      .unsuspendSite(s.id)
      .then((u) => {
        replaceSite(u);
        toast(t('admin.site.reEnabled'));
      })
      .catch((e) => toastError(e, t('admin.site.reEnableFailed')))
      .finally(() => setBusySite(null));
  };

  const deleteSiteAdmin = async (s: AdminSite) => {
    const ok = await confirmDanger({
      title: t('admin.site.deleteTitle', { slug: s.slug, handle: s.owner_handle }),
      body: t('admin.site.deleteBody'),
      confirmText: t('admin.site.deleteConfirm'),
    });
    if (!ok) return;
    setBusySite(s.id);
    api
      .adminDeleteSite(s.id)
      .then(() => {
        setSites((prev) => (prev ?? []).filter((x) => x.id !== s.id));
        toast(t('admin.site.deleted'));
      })
      .catch((e) => toastError(e, t('admin.site.deleteFailed')))
      .finally(() => setBusySite(null));
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
              <Shield className="h-3 w-3" /> {t('admin.badge')}
            </span>
            <a
              href="/"
              className="flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-tide-700"
            >
              <ArrowLeft className="h-4 w-4" /> {t('admin.backToSites')}
            </a>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <div className="text-right leading-tight">
              <div className="text-sm font-semibold text-ink-700">{me.display_name}</div>
              {me.handle && <div className="font-mono text-xs text-ink-400">@{me.handle}</div>}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900">{t('admin.title')}</h1>
          <p className="mt-1 text-sm text-ink-500">{t('admin.subtitle')}</p>
        </div>

        {/* Overview */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={<Database className="h-4 w-4" />}
            label={t('admin.stat.sites')}
            value={overview ? String(overview.sites) : '—'}
            sub={t('admin.stat.sitesSub')}
            tint="#e6f4f2"
            ink="#0b6358"
          />
          <StatCard
            icon={<UsersIcon className="h-4 w-4" />}
            label={t('admin.stat.users')}
            value={overview ? String(overview.users) : '—'}
            sub={
              overview
                ? t(
                    overview.admins === 1
                      ? 'admin.stat.adminsSub.one'
                      : 'admin.stat.adminsSub.other',
                    { n: overview.admins },
                  )
                : ' '
            }
            tint="#e8f0f9"
            ink="#1f4f86"
          />
          <StatCard
            icon={<HardDrive className="h-4 w-4" />}
            label={t('admin.stat.storage')}
            value={overview ? formatBytes(overview.storage_bytes) : '—'}
            sub={t('admin.stat.storageSub')}
            tint="#faf0db"
            ink="#8a560b"
          />
          <StatCard
            icon={<Database className="h-4 w-4" />}
            label={t('admin.stat.versions')}
            value={overview ? String(overview.versions) : '—'}
            sub={t('admin.stat.versionsSub')}
            tint="#f0eafb"
            ink="#5b3596"
          />
        </div>

        {/* Registration & invites */}
        <Card>
          <h2 className="text-sm font-bold text-ink-800">{t('admin.reg.heading')}</h2>
          {!isPassword ? (
            <p className="mt-3 text-xs text-ink-400">
              {t('admin.reg.authPrefix')}{' '}
              <span className="font-mono">{settings?.auth_mode ?? '…'}</span>{' '}
              {t('admin.reg.authSuffix')}
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
                        {t(m.labelKey)}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-400">{t(m.descKey)}</div>
                    </button>
                  );
                })}
              </div>
              {locked && (
                <p className="mt-2 text-xs text-ink-400">
                  {t('admin.reg.lockedPre')}{' '}
                  <span className="font-mono">PAGEPIN_REGISTRATION_MODE</span>{' '}
                  {t('admin.reg.lockedPost')}
                </p>
              )}

              {regMode !== 'closed' && (
                <div className="mt-5 rounded-panel border border-ink-200 bg-ink-50 p-4">
                  <div className="flex items-center gap-2 text-ink-700">
                    <Mail className="h-4 w-4 text-tide-600" />
                    <span className="text-sm font-semibold">{t('admin.invite.heading')}</span>
                    <span className="text-xs text-ink-400">{t('admin.invite.oneTimeNote')}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      className="input !w-56"
                      type="email"
                      placeholder={t('admin.invite.emailPlaceholder')}
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
                      {t('admin.invite.asAdmin')}
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
                      {t('admin.invite.generate')}
                    </button>
                  </div>

                  {generated && (
                    <div className="mt-3 rounded-field border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs text-amber-800">
                        {t('admin.invite.copyNow')}
                        {generated.email
                          ? t('admin.invite.sendTo', { email: generated.email })
                          : ' '}
                        {t('admin.invite.worksOnce')}
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
                              toast(
                                ok ? t('admin.invite.linkCopied') : t('admin.invite.copyFailed'),
                                ok ? 'ok' : 'err',
                              );
                            })
                          }
                        >
                          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          {t('common.copy')}
                        </button>
                      </div>
                    </div>
                  )}

                  {invites.length > 0 && (
                    <div className="mt-4 border-t border-ink-200 pt-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                        {t('admin.invite.linksHeading')}
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {invites.map((inv) => (
                          <div
                            key={inv.id}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="truncate font-mono text-ink-600">
                              {inv.email ?? t('admin.invite.anyEmail')}
                              {inv.is_admin && (
                                <span className="ml-1 text-tide-600">
                                  {t('admin.invite.adminTag')}
                                </span>
                              )}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className={inv.expired ? 'text-red-500' : 'text-ink-400'}>
                                {inv.expired
                                  ? t('admin.invite.expired')
                                  : t('admin.invite.expiresIn', {
                                      when: formatRelative(inv.expires_at),
                                    })}
                              </span>
                              <button
                                type="button"
                                className="text-red-500 hover:text-red-600 hover:underline"
                                onClick={() => void revokeInvite(inv)}
                              >
                                {t('admin.invite.revoke')}
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
            <h2 className="text-sm font-bold text-ink-800">{t('admin.users.heading')}</h2>
            <span className="text-xs text-ink-400">
              {users ? t('admin.users.total', { n: users.length }) : ''}
            </span>
          </div>
          <div className="mt-3 divide-y divide-ink-100 border-t border-ink-100">
            {users === null ? (
              <div className="flex items-center gap-2 py-4 text-xs text-ink-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('common.loading')}
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
                        {u.handle ? `@${u.handle}` : t('admin.users.noHandle')}
                      </span>
                      <RolePill u={u} />
                      {u.id === me.sub && (
                        <span className="text-[11px] text-ink-400">{t('admin.users.you')}</span>
                      )}
                    </div>
                    <div className="truncate text-xs text-ink-400">{u.email ?? '—'}</div>
                  </div>
                  <div className="hidden text-right text-xs text-ink-400 sm:block">
                    <div>
                      {t(u.site_count === 1 ? 'admin.users.sites.one' : 'admin.users.sites.other', {
                        n: u.site_count,
                      })}{' '}
                      · {formatBytes(u.storage_bytes)}
                    </div>
                    <div>
                      {u.last_login_at
                        ? t('admin.users.active', { when: formatRelative(u.last_login_at) })
                        : t('admin.users.never')}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {busy === u.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-400" />}
                    {!u.email_verified && (
                      <button
                        type="button"
                        className="rounded-chip px-2 py-1 text-xs text-tide-600 hover:bg-tide-50 disabled:opacity-40 disabled:hover:bg-transparent"
                        disabled={busy === u.id}
                        title={t('admin.users.verifyTitle')}
                        onClick={() => verifyUser(u)}
                      >
                        {t('admin.users.verifyEmail')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded-chip px-2 py-1 text-xs text-ink-500 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-40 disabled:hover:bg-transparent"
                      disabled={busy === u.id || u.id === me.sub}
                      title={u.id === me.sub ? t('admin.users.ownRoleTitle') : undefined}
                      onClick={() =>
                        patchUser(
                          u,
                          { is_admin: !u.is_admin },
                          u.is_admin ? t('admin.user.adminRemoved') : t('admin.user.promoted'),
                        )
                      }
                    >
                      {u.is_admin ? t('admin.users.removeAdmin') : t('admin.users.makeAdmin')}
                    </button>
                    <button
                      type="button"
                      className={`rounded-chip px-2 py-1 text-xs disabled:opacity-40 disabled:hover:bg-transparent ${
                        u.disabled
                          ? 'text-tide-600 hover:bg-tide-50'
                          : 'text-red-500 hover:bg-red-50 hover:text-red-600'
                      }`}
                      disabled={busy === u.id || u.id === me.sub}
                      title={u.id === me.sub ? t('admin.users.ownAccessTitle') : undefined}
                      onClick={() => void toggleDisabled(u)}
                    >
                      {u.disabled ? t('admin.users.enable') : t('admin.users.disable')}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Sites — moderation */}
        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-ink-800">{t('admin.sitesSection.heading')}</h2>
            <span className="text-xs text-ink-400">
              {sites ? t('admin.users.total', { n: sites.length }) : ''}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-400">{t('admin.sitesSection.note')}</p>
          <div className="mt-3 divide-y divide-ink-100 border-t border-ink-100">
            {sites === null ? (
              <div className="flex items-center gap-2 py-4 text-xs text-ink-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('common.loading')}
              </div>
            ) : sites.length === 0 ? (
              <div className="py-4 text-xs text-ink-400">{t('admin.sitesSection.empty')}</div>
            ) : (
              sites.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`truncate font-mono text-sm font-semibold ${s.suspended ? 'text-ink-400 line-through' : 'text-ink-700'}`}
                      >
                        {s.slug}
                      </span>
                      {s.suspended ? (
                        <span className="rounded-chip border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                          {t('admin.site.badgeDisabled')}
                        </span>
                      ) : s.visibility === 'public' ? (
                        <span className="inline-flex items-center gap-1 rounded-chip border border-tide-200 bg-tide-50 px-2 py-0.5 text-xs font-medium text-tide-700">
                          <Globe2 className="h-3 w-3" /> {t('admin.site.public')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-chip border border-ink-200 bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-500">
                          <Lock className="h-3 w-3" /> {t('admin.site.private')}
                        </span>
                      )}
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        title={t('admin.sitesSection.openPage')}
                        className="text-ink-300 hover:text-tide-700"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    <div className="truncate text-xs text-ink-400">
                      @{s.owner_handle} ·{' '}
                      {t(
                        s.file_count === 1
                          ? 'admin.sitesSection.files.one'
                          : 'admin.sitesSection.files.other',
                        { n: s.file_count },
                      )}{' '}
                      · {formatBytes(s.total_bytes)} ·{' '}
                      {t('admin.sitesSection.updated', { when: formatRelative(s.updated_at) })}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {busySite === s.id && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-400" />
                    )}
                    {s.suspended ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-chip px-2 py-1 text-xs text-tide-600 hover:bg-tide-50 disabled:opacity-40"
                        disabled={busySite === s.id}
                        onClick={() => unsuspendSite(s)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> {t('admin.sitesSection.reEnable')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-chip px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-40"
                        disabled={busySite === s.id}
                        onClick={() => void suspendSite(s)}
                      >
                        <Ban className="h-3.5 w-3.5" /> {t('admin.users.disable')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-chip px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      disabled={busySite === s.id}
                      onClick={() => void deleteSiteAdmin(s)}
                      title={t('admin.sitesSection.deleteTitle')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
            <h2 className="text-sm font-bold text-ink-800">{t('admin.limits.heading')}</h2>
            <p className="mt-1 text-xs text-ink-400">{t('admin.limits.note')}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Limit name="PAGEPIN_MAX_SITE_MB" value={`${settings.limits.max_site_mb} MB`} />
              <Limit name="PAGEPIN_MAX_FILE_MB" value={`${settings.limits.max_file_mb} MB`} />
              <Limit name="PAGEPIN_MAX_FILES" value={String(settings.limits.max_files)} />
              <Limit
                name="PAGEPIN_PUBLIC_MAX_HOURS"
                value={`${settings.limits.public_max_hours} h`}
              />
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
