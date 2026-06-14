import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, KeyRound, Loader2, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { confirmDanger } from './ConfirmDialog';
import { copyText, formatRelative } from '../lib/format';
import type { TokenItem } from '../types';
import { toast, toastError } from './Toast';

/** A ready-to-paste, one-line instruction for an agent (skill.md link + plaintext token). */
function aiPrompt(token: string): string {
  return `Read ${location.origin}/skill.md and follow it to deploy/update pages with the pagepin API. My token: ${token}`;
}

/** API Token 管理：创建 / 列表（明文随时可复制）/ 吊销。给 AI/脚本部署用。
 *  ★ 必须 createPortal 到 body：TopBar 的 backdrop-blur 会让 fixed 以 header 为包含块，弹窗被压进导航条。 */
export function TokenDialog({ onClose }: { onClose: () => void }) {
  const [tokens, setTokens] = useState<TokenItem[] | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  /** 最近一次复制动作的标识（"<id>:token" / "<id>:prompt"），用于打勾反馈 */
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, key: string) => {
    void copyText(text).then((ok) => {
      if (ok) {
        setCopied(key);
        toast('Copied');
      } else {
        toast('Copy failed — select and copy manually', 'err');
      }
    });
  };

  const refresh = useCallback(() => {
    api
      .listTokens()
      .then(({ tokens }) => setTokens(tokens))
      .catch((e) => toastError(e, 'Failed to load tokens'));
  }, []);

  useEffect(() => refresh(), [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = () => {
    const n = name.trim() || 'ai-deploy';
    setCreating(true);
    api
      .createToken(n)
      .then((t) => {
        setName('');
        setTokens((prev) => [t, ...(prev ?? [])]);
        toast(`“${t.name}” created`);
      })
      .catch((e) => toastError(e, 'Create failed'))
      .finally(() => setCreating(false));
  };

  const rotate = async (t: TokenItem) => {
    const ok = await confirmDanger({
      title: `Rotate “${t.name}”?`,
      body: 'The old token stops working immediately; any agent or script using it needs the new value.',
      confirmText: 'Rotate',
    });
    if (!ok) return;
    api
      .rotateToken(t.id)
      .then((nt) => {
        setTokens((prev) => (prev ?? []).map((x) => (x.id === nt.id ? nt : x)));
        toast('Rotated — copy the new value to your agent');
      })
      .catch((e) => toastError(e, 'Rotate failed'));
  };

  const revoke = async (t: TokenItem) => {
    const ok = await confirmDanger({
      title: `Revoke “${t.name}”?`,
      body: 'Any agent or script using it stops working immediately, and this cannot be undone.',
      confirmText: 'Revoke',
    });
    if (!ok) return;
    api
      .revokeToken(t.id)
      .then(() => {
        toast('Revoked');
        refresh();
      })
      .catch((e) => toastError(e, 'Revoke failed'));
  };

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
          <div className="flex items-center gap-2 text-ink-800">
            <KeyRound className="h-4 w-4 text-tide-600" />
            <span className="text-sm font-bold">API tokens</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-chip p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-ink-400">
          Deploy credentials for agents &amp; CI, scoped to your sites. The{' '}
          <Sparkles className="inline h-3 w-3 -translate-y-px text-tide-500" /> button next to a
          token copies a ready-to-paste prompt with the{' '}
          <a href="/skill.md" target="_blank" rel="noreferrer" className="text-tide-600 underline">
            skill guide
          </a>{' '}
          link and the token — paste it into your agent and it can deploy right away.
        </p>

        {/* 创建 */}
        <div className="mt-4 flex gap-2">
          <input
            className="input font-mono"
            placeholder="Label, e.g. claude-deploy"
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !creating && create()}
          />
          <button type="button" className="btn-primary shrink-0" disabled={creating} onClick={create}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create
          </button>
        </div>

        {/* 列表 */}
        <div className="mt-4 divide-y divide-ink-100 border-t border-ink-100">
          {tokens === null ? (
            <div className="flex items-center gap-2 py-4 text-xs text-ink-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : tokens.length === 0 ? (
            <div className="py-4 text-xs text-ink-400">No tokens yet — create one.</div>
          ) : (
            tokens.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink-700">{t.name}</div>
                  {/* 默认打码（前缀 + ●●●●），复制才给明文 */}
                  <div className="truncate font-mono text-xs text-ink-400">
                    {t.token
                      ? `${t.prefix}●●●●●●●●●●`
                      : `${t.prefix}… (legacy token — can't be shown; revoke & recreate)`}
                  </div>
                  <div className="text-xs text-ink-300">
                    {t.last_used_at ? `Last used ${formatRelative(t.last_used_at)}` : 'Never used'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {t.token && (
                    <>
                      <button
                        type="button"
                        title="Copy AI-ready prompt"
                        className="rounded-chip p-2 text-tide-500 hover:bg-tide-50 hover:text-tide-700"
                        onClick={() => copy(aiPrompt(t.token!), `${t.id}:prompt`)}
                      >
                        {copied === `${t.id}:prompt` ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        title="Copy token"
                        className="rounded-chip p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
                        onClick={() => copy(t.token!, `${t.id}:token`)}
                      >
                        {copied === `${t.id}:token` ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        title="Rotate (new value; the old one stops working)"
                        className="rounded-chip p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
                        onClick={() => void rotate(t)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    title="Revoke"
                    className="rounded-chip p-2 text-ink-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => void revoke(t)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
