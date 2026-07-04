import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Link2, Loader2, ShieldOff, X } from 'lucide-react';
import { api } from '../api';
import { useT } from '../i18n';
import { confirmDanger } from './ConfirmDialog';
import { copyText } from '../lib/format';
import { useStore } from '../store';
import type { ShareLinkOut, SiteOut } from '../types';
import { toast, toastError } from './Toast';

/** 时效选项（小时）；服务端默认 72、cap 720。 */
const SHARE_LINK_HOURS = [24, 72, 168, 720] as const;
const DEFAULT_HOURS = 72;

/** 站点「分享链接」弹窗：签发带 ?key= 的无账号可看链接 + 访客评论开关 + 一键撤销全部。
 *  ★ 同 TokenDialog：必须 createPortal 到 body，避免 backdrop-blur 改变 fixed 包含块。 */
export function ShareLinkDialog({ site, onClose }: { site: SiteOut; onClose: () => void }) {
  const t = useT();
  const upsertSite = useStore((s) => s.upsertSite);

  const [hours, setHours] = useState<number>(DEFAULT_HOURS);
  const [link, setLink] = useState<ShareLinkOut | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function create() {
    if (creating) return;
    setCreating(true);
    api
      .createShareLink(site.slug, hours)
      .then((out) => {
        setLink(out);
        setCopied(false);
        toast(t('sites.toast.shareLinkCreated'));
      })
      .catch((e) => toastError(e, t('sites.shareLink.createFailed')))
      .finally(() => setCreating(false));
  }

  function copyLink() {
    if (!link) return;
    void copyText(link.url).then((ok) => {
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
        toast(t('sites.toast.linkCopied'));
      } else {
        toast(t('sites.toast.copyFailed'), 'err');
      }
    });
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
        toast(t('sites.toast.shareLinksRevoked'));
      })
      .catch((e) => toastError(e))
      .finally(() => setBusy(false));
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

        {/* —— 时效 + 生成 —— */}
        <div className="mt-4">
          <div className="text-xs font-semibold text-ink-500">{t('sites.shareLink.expiresIn')}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SHARE_LINK_HOURS.map((h) => (
              <button
                key={h}
                type="button"
                disabled={creating}
                onClick={() => setHours(h)}
                className={`rounded-field border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  hours === h
                    ? 'border-tide-300 bg-tide-50 text-tide-700'
                    : 'border-ink-200 bg-white text-ink-600 hover:border-tide-300 hover:text-tide-700'
                }`}
              >
                {t(`sites.shareLink.h${h}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-primary mt-3 !px-3.5 !py-2 !text-xs"
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

        {/* —— 生成结果：一次性展示 + Copy（复用 TokenManager 的打勾反馈模式） —— */}
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
                onClick={copyLink}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <div className="mt-2 text-xs text-ink-500">
              {t('sites.shareLink.expiresAt', {
                time: new Date(link.expires_at).toLocaleString(),
              })}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-400">
              {t('sites.shareLink.oneTime')}
            </p>
          </div>
        )}

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
