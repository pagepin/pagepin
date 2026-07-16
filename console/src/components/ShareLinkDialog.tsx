import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Link2, Loader2, ShieldOff, X } from 'lucide-react';
import { api } from '../api';
import { useT } from '../i18n';
import { confirmDanger } from './ConfirmDialog';
import { copyText } from '../lib/format';
import { useStore } from '../store';
import type { ShareLinkItem, ShareLinkOut, SiteOut } from '../types';
import { toast, toastError } from './Toast';

/** 时效选项（小时）；null = 永不过期（默认，撤销是主要管控手段），数字受服务端 cap 720 钳制。 */
const SHARE_LINK_HOURS = [null, 24, 72, 168, 720] as const;

/** 站点「分享链接」弹窗：签发落库短码链接（/s/<code>）+ 已生成链接列表（单条撤销）
 *  + 访客评论开关 + 一键撤销全部。
 *  ★ 同 TokenDialog：必须 createPortal 到 body，避免 backdrop-blur 改变 fixed 包含块。 */
export function ShareLinkDialog({ site, onClose }: { site: SiteOut; onClose: () => void }) {
  const t = useT();
  const upsertSite = useStore((s) => s.upsertSite);

  const [hours, setHours] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const [link, setLink] = useState<ShareLinkOut | null>(null);
  const [links, setLinks] = useState<ShareLinkItem[] | null>(null); // null = 加载中
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null); // 打勾反馈的目标(code 或 'new')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const refreshLinks = useCallback(() => {
    api
      .listShareLinks(site.slug)
      .then((out) => setLinks(out.links))
      .catch(() => setLinks([]));
  }, [site.slug]);

  useEffect(() => {
    refreshLinks();
  }, [refreshLinks]);

  function create() {
    if (creating) return;
    setCreating(true);
    api
      .createShareLink(site.slug, hours, label.trim() || undefined)
      .then((out) => {
        setLink(out);
        setLabel('');
        setCopied(null);
        refreshLinks();
        toast(t('sites.toast.shareLinkCreated'));
      })
      .catch((e) => toastError(e, t('sites.shareLink.createFailed')))
      .finally(() => setCreating(false));
  }

  function copyLink(url: string, key: string) {
    void copyText(url).then((ok) => {
      if (ok) {
        setCopied(key);
        window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
        toast(t('sites.toast.linkCopied'));
      } else {
        toast(t('sites.toast.copyFailed'), 'err');
      }
    });
  }

  function revokeOne(code: string) {
    if (busy) return;
    setBusy(true);
    api
      .revokeShareLink(site.slug, code)
      .then(() => {
        if (link?.code === code) setLink(null);
        refreshLinks();
        toast(t('sites.toast.shareLinkRevoked'));
      })
      .catch((e) => toastError(e, t('sites.shareLink.revokeOneFailed')))
      .finally(() => setBusy(false));
  }

  function toggleGuestComments(next: boolean) {
    if (busy) return;
    setBusy(true);
    api
      .patchSite(site.slug, { guest_comments: next })
      .then((updated) => {
        upsertSite(updated);
        toast(next ? t('sites.toast.guestCommentsOn') : t('sites.toast.guestCommentsOff'));
      })
      .catch((e) => toastError(e))
      .finally(() => setBusy(false));
  }

  async function revokeAll() {
    const ok = await confirmDanger({
      title: t('sites.shareLink.revokeTitle', { slug: site.slug }),
      body: t('sites.shareLink.revokeBody'),
      confirmText: t('sites.shareLink.revokeConfirm'),
    });
    if (!ok) return;
    if (busy) return;
    setBusy(true);
    api
      .revokeShareLinks(site.slug)
      .then(() => {
        setLink(null);
        refreshLinks();
        toast(t('sites.toast.shareLinksRevoked'));
      })
      .catch((e) => toastError(e))
      .finally(() => setBusy(false));
  }

  /** 列表项的到期描述：null → 永不过期；已过线 → 已过期。 */
  function expiryLabel(expiresAt: string | null): { text: string; expired: boolean } {
    if (expiresAt === null) return { text: t('sites.shareLink.listNever'), expired: false };
    const d = new Date(expiresAt);
    if (d.getTime() <= Date.now()) return { text: t('sites.shareLink.listExpired'), expired: true };
    return { text: t('sites.shareLink.listExpires', { time: d.toLocaleString() }), expired: false };
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/55 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-card border border-ink-200 bg-white p-6 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2 text-ink-800">
            <Link2 className="h-4 w-4 shrink-0 text-tide-600" />
            <span className="truncate text-sm font-bold">
              {t('sites.shareLink.title', { slug: site.slug })}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-chip p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-ink-400">{t('sites.shareLink.desc')}</p>

        {/* —— 时效 + 备注 + 生成 —— */}
        <div className="mt-4">
          <div className="text-xs font-semibold text-ink-500">{t('sites.shareLink.expiresIn')}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SHARE_LINK_HOURS.map((h) => (
              <button
                key={h ?? 'perm'}
                type="button"
                disabled={creating}
                onClick={() => setHours(h)}
                className={`rounded-field border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  hours === h
                    ? 'border-tide-300 bg-tide-50 text-tide-700'
                    : 'border-ink-200 bg-white text-ink-600 hover:border-tide-300 hover:text-tide-700'
                }`}
              >
                {h === null ? t('sites.shareLink.hPerm') : t(`sites.shareLink.h${h}`)}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={label}
              disabled={creating}
              maxLength={120}
              placeholder={t('sites.shareLink.labelPlaceholder')}
              onChange={(e) => setLabel(e.target.value)}
              className="min-w-0 flex-1 rounded-field border border-ink-200 bg-white px-2.5 py-1.5 text-xs text-ink-700 placeholder:text-ink-300"
            />
            <button
              type="button"
              className="btn-primary shrink-0 !px-3.5 !py-2 !text-xs"
              disabled={creating}
              onClick={create}
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              {link ? t('sites.shareLink.createAnother') : t('sites.shareLink.create')}
            </button>
          </div>
        </div>

        {/* —— 生成结果:落库短链 + Copy(打勾反馈模式沿用 TokenManager) —— */}
        {link && (
          <div className="mt-4 rounded-panel border border-tide-200 bg-tide-50 p-3 animate-fade-up">
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                value={link.url}
                onFocus={(e) => e.target.select()}
                className="min-w-0 flex-1 rounded-field border border-ink-200 bg-white px-2.5 py-1.5 font-mono text-xs text-tide-700"
              />
              <button
                type="button"
                title={t('sites.copyLink')}
                className="shrink-0 rounded-chip p-2 text-ink-400 hover:bg-white hover:text-tide-700"
                onClick={() => copyLink(link.url, 'new')}
              >
                {copied === 'new' ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <div className="mt-2 text-xs text-ink-500">
              {link.expires_at === null
                ? t('sites.shareLink.never')
                : t('sites.shareLink.expiresAt', {
                    time: new Date(link.expires_at).toLocaleString(),
                  })}
            </div>
          </div>
        )}

        {/* —— 已生成的链接:随时找回 / 单条撤销 —— */}
        <div className="mt-5 border-t border-ink-100 pt-4">
          <div className="text-xs font-semibold text-ink-500">{t('sites.shareLink.listTitle')}</div>
          {links === null ? (
            <div className="mt-2 flex items-center gap-2 text-xs text-ink-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </div>
          ) : links.length === 0 ? (
            <p className="mt-2 text-xs text-ink-400">{t('sites.shareLink.listEmpty')}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {links.map((l) => {
                const exp = expiryLabel(l.expires_at);
                return (
                  <li
                    key={l.code}
                    className="flex items-center gap-2 rounded-field border border-ink-100 bg-ink-50/50 px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs text-ink-700">{l.url}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-400">
                        {l.label && <span className="truncate text-ink-500">{l.label}</span>}
                        <span className={exp.expired ? 'text-amber-600' : ''}>{exp.text}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      title={t('sites.copyLink')}
                      className="shrink-0 rounded-chip p-1.5 text-ink-400 hover:bg-white hover:text-tide-700"
                      onClick={() => copyLink(l.url, l.code)}
                    >
                      {copied === l.code ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn-danger-ghost shrink-0 !px-2 !py-1 !text-[11px]"
                      disabled={busy}
                      onClick={() => revokeOne(l.code)}
                    >
                      {t('sites.shareLink.revokeOne')}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* —— 访客评论开关 —— */}
        <label className="mt-5 flex cursor-pointer items-start justify-between gap-3 border-t border-ink-100 pt-4">
          <span>
            <span className="block text-xs font-semibold text-ink-700">
              {t('sites.shareLink.guestComments')}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">
              {t('sites.shareLink.guestCommentsDesc')}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={site.guest_comments}
            disabled={busy}
            onClick={() => toggleGuestComments(!site.guest_comments)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              site.guest_comments ? 'bg-tide-600' : 'bg-ink-300'
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                site.guest_comments ? 'left-[18px]' : 'left-0.5'
              }`}
            />
          </button>
        </label>

        {/* —— 撤销全部 —— */}
        <div className="mt-4 flex items-start justify-between gap-3 border-t border-ink-100 pt-4">
          <p className="text-xs leading-relaxed text-ink-400">{t('sites.shareLink.revokeDesc')}</p>
          <button
            type="button"
            className="btn-danger-ghost shrink-0 !px-2.5 !py-1.5 !text-xs"
            disabled={busy}
            onClick={() => void revokeAll()}
          >
            <ShieldOff className="h-3.5 w-3.5" />
            {t('sites.shareLink.revokeAll')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
