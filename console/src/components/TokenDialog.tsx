import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, KeyRound, Loader2, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { confirmDanger } from './ConfirmDialog';
import { copyText, formatRelative } from '../lib/format';
import type { TokenItem } from '../types';
import { toast, toastError } from './Toast';

/** 丢给 AI 的一句话（含使用说明链接和 token 明文） */
function aiPrompt(token: string): string {
  return `读 ${location.origin}/skill.md，按里面的说明用 pagepin API 帮我部署/更新页面。我的 API token：${token}`;
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
        toast('已复制');
      } else {
        toast('复制失败，请手动选中复制', 'err');
      }
    });
  };

  const refresh = useCallback(() => {
    api
      .listTokens()
      .then(({ tokens }) => setTokens(tokens))
      .catch((e) => toastError(e, '加载 token 失败'));
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
        toast(`「${t.name}」已创建`);
      })
      .catch((e) => toastError(e, '创建失败'))
      .finally(() => setCreating(false));
  };

  const rotate = async (t: TokenItem) => {
    const ok = await confirmDanger({
      title: `轮换「${t.name}」？`,
      body: '旧 token 立即失效，正在用它的 AI/脚本需要换成新值。',
      confirmText: '轮换',
    });
    if (!ok) return;
    api
      .rotateToken(t.id)
      .then((nt) => {
        setTokens((prev) => (prev ?? []).map((x) => (x.id === nt.id ? nt : x)));
        toast('已轮换，复制新值给 AI');
      })
      .catch((e) => toastError(e, '轮换失败'));
  };

  const revoke = async (t: TokenItem) => {
    const ok = await confirmDanger({
      title: `吊销「${t.name}」？`,
      body: '正在用它的 AI/脚本会立即失效，且无法恢复。',
      confirmText: '吊销',
    });
    if (!ok) return;
    api
      .revokeToken(t.id)
      .then(() => {
        toast('已吊销');
        refresh();
      })
      .catch((e) => toastError(e, '吊销失败'));
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-stone-800">
            <KeyRound className="h-4 w-4 text-tide-600" />
            <span className="text-sm font-semibold">API Token</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-stone-400">
          给 AI / 脚本用的部署凭证，只对你自己的站点有效。每个 token 旁的 ✨
          按钮会复制一句带{' '}
          <a href="/skill.md" target="_blank" rel="noreferrer" className="text-tide-600 underline">
            使用说明
          </a>{' '}
          和 token 的提示语 —— 直接粘贴给 AI 就能让它部署。
        </p>

        {/* 创建 */}
        <div className="mt-4 flex gap-2">
          <input
            className="input font-mono"
            placeholder="备注名，如 claude-deploy"
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !creating && create()}
          />
          <button type="button" className="btn-primary shrink-0" disabled={creating} onClick={create}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            创建
          </button>
        </div>

        {/* 列表 */}
        <div className="mt-4 divide-y divide-stone-100 border-t border-stone-100">
          {tokens === null ? (
            <div className="flex items-center gap-2 py-4 text-xs text-stone-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载中…
            </div>
          ) : tokens.length === 0 ? (
            <div className="py-4 text-xs text-stone-400">还没有 token，创建一个吧</div>
          ) : (
            tokens.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-stone-700">{t.name}</div>
                  {/* 默认打码（前缀 + ●●●●），复制才给明文 */}
                  <div className="truncate font-mono text-xs text-stone-400">
                    {t.token ? `${t.prefix}●●●●●●●●●●` : `${t.prefix}…（旧 token 不可查看，请吊销重建）`}
                  </div>
                  <div className="text-xs text-stone-300">
                    {t.last_used_at ? `最近使用 ${formatRelative(t.last_used_at)}` : '从未使用'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {t.token && (
                    <>
                      <button
                        type="button"
                        title="复制「丢给 AI 的提示语」"
                        className="rounded-lg p-2 text-tide-500 hover:bg-tide-50 hover:text-tide-700"
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
                        title="复制 token"
                        className="rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
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
                        title="轮换（换新值，旧值立即失效）"
                        className="rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
                        onClick={() => void rotate(t)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    title="吊销"
                    className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600"
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
