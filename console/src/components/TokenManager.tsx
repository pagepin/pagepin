import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api } from '../api';
import { useT } from '../i18n';
import { confirmDanger } from './ConfirmDialog';
import { copyText, formatRelative } from '../lib/format';
import type { TokenItem } from '../types';
import { toast, toastError } from './Toast';

/** A ready-to-paste, one-line install command for the pagepin agent skill.
 * Deliberately TOKEN-FREE: the agent gets the token via browser device-login (see skill.md),
 * so the secret never lands in a chat transcript. */
function aiPrompt(): string {
  return 'npx skills add pagepin/pagepin -g';
}

/** API token 列表 + 创建 + 复制/轮换/吊销 —— 不带任何外框，供 TokenDialog 与 Settings 复用。
 * token 明文是 show-once：只有创建/轮换的响应携带，这里存进 React state（fresh）供本页
 * 会话内反复复制，刷新即失；列表接口只回 prefix，历史值无从找回（轮换拿新值）。 */
export function TokenManager() {
  const t = useT();
  const [tokens, setTokens] = useState<TokenItem[] | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  /** id → 本页会话内已知的明文（仅来自刚创建/轮换的响应，不持久化） */
  const [fresh, setFresh] = useState<Record<string, string>>({});
  /** 刚创建/轮换出的 token —— 触发列表上方的醒目「唯一一次」高亮卡片；
   *  点「我已保存好了」才收起（不自动消失），这是 show-once 最关键的一屏。 */
  const [justCreated, setJustCreated] = useState<{ name: string; token: string } | null>(null);
  /** 最近一次复制动作标识（"<id>:token" / "<id>:prompt" / "card:token"），用于打勾反馈 */
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, key: string) => {
    void copyText(text).then((ok) => {
      if (ok) {
        setCopied(key);
        window.setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 1500);
        toast(t('common.copied'));
      } else {
        toast(t('tokens.copyFailed'), 'err');
      }
    });
  };

  const refresh = useCallback(() => {
    api
      .listTokens()
      .then(({ tokens }) => setTokens(tokens))
      .catch((e) => toastError(e, t('tokens.loadFailed')));
  }, [t]);

  useEffect(() => refresh(), [refresh]);

  const create = () => {
    const n = name.trim() || 'ai-deploy';
    setCreating(true);
    api
      .createToken(n)
      .then((tok) => {
        setName('');
        if (tok.token) {
          setFresh((f) => ({ ...f, [tok.id]: tok.token! }));
          setJustCreated({ name: tok.name, token: tok.token });
        }
        setTokens((prev) => [tok, ...(prev ?? [])]);
        toast(t('tokens.created', { name: tok.name }));
      })
      .catch((e) => toastError(e, t('tokens.createFailed')))
      .finally(() => setCreating(false));
  };

  const rotate = async (tok: TokenItem) => {
    const ok = await confirmDanger({
      title: t('tokens.rotateTitle', { name: tok.name }),
      body: t('tokens.rotateBody'),
      confirmText: t('tokens.rotateConfirm'),
    });
    if (!ok) return;
    api
      .rotateToken(tok.id)
      .then((nt) => {
        if (nt.token) {
          setFresh((f) => ({ ...f, [nt.id]: nt.token! }));
          setJustCreated({ name: nt.name, token: nt.token });
        }
        setTokens((prev) => (prev ?? []).map((x) => (x.id === nt.id ? nt : x)));
        toast(t('tokens.rotated'));
      })
      .catch((e) => toastError(e, t('tokens.rotateFailed')));
  };

  const revoke = async (tok: TokenItem) => {
    const ok = await confirmDanger({
      title: t('tokens.revokeTitle', { name: tok.name }),
      body: t('tokens.revokeBody'),
      confirmText: t('tokens.revokeConfirm'),
    });
    if (!ok) return;
    api
      .revokeToken(tok.id)
      .then(() => {
        toast(t('tokens.revoked'));
        refresh();
      })
      .catch((e) => toastError(e, t('tokens.revokeFailed')));
  };

  return (
    <div>
      <p className="text-xs leading-relaxed text-ink-400">
        {t('tokens.hintLead')}
        <Sparkles className="inline h-3 w-3 -translate-y-px text-tide-500" />
        {t('tokens.hintButtonCopies')}
        <a
          href="https://github.com/vercel-labs/skills"
          target="_blank"
          rel="noreferrer"
          className="text-tide-600 underline"
        >
          {t('tokens.hintNpxSkills')}
        </a>
        {t('tokens.hintInstallCmd')}
        <a href="/skill.md" target="_blank" rel="noreferrer" className="text-tide-600 underline">
          {t('tokens.hintSkillGuide')}
        </a>
        {t('tokens.hintTail')}
      </p>

      <div className="mt-4 flex gap-2">
        <input
          className="input font-mono"
          placeholder={t('tokens.namePlaceholder')}
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !creating && create()}
        />
        <button type="button" className="btn-primary shrink-0" disabled={creating} onClick={create}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t('tokens.createButton')}
        </button>
      </div>

      {justCreated && (
        <div className="mt-4 rounded-card border border-amber-300 bg-amber-50 px-4 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <Check className="h-4 w-4 shrink-0 text-amber-600" />
            {t('tokens.createdCardTitle', { name: justCreated.name })}
          </div>
          <div className="mt-2.5 flex items-stretch gap-2">
            <code className="min-w-0 flex-1 break-all rounded-field border border-amber-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-ink-700">
              {justCreated.token}
            </code>
            <button
              type="button"
              className="btn-primary shrink-0 self-start"
              onClick={() => copy(justCreated.token, 'card:token')}
            >
              {copied === 'card:token' ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied === 'card:token' ? t('common.copied') : t('tokens.copyButton')}
            </button>
          </div>
          <div className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t('tokens.showOnceWarning')}</span>
          </div>
          <div className="mt-2.5 text-right">
            <button
              type="button"
              className="text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
              onClick={() => setJustCreated(null)}
            >
              {t('tokens.savedIt')}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 divide-y divide-ink-100 border-t border-ink-100">
        {tokens === null ? (
          <div className="flex items-center gap-2 py-4 text-xs text-ink-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('common.loading')}
          </div>
        ) : tokens.length === 0 ? (
          <div className="py-4 text-xs text-ink-400">{t('tokens.empty')}</div>
        ) : (
          tokens.map((tok) => (
            <div key={tok.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink-700">{tok.name}</div>
                <div className="truncate font-mono text-xs text-ink-400">
                  {fresh[tok.id]
                    ? `${tok.prefix}●●●●●●●●●●`
                    : `${tok.prefix}${t('tokens.hiddenSuffix')}`}
                </div>
                <div className="text-xs text-ink-300">
                  {tok.last_used_at
                    ? t('tokens.lastUsed', { time: formatRelative(tok.last_used_at) })
                    : t('tokens.neverUsed')}
                  {tok.expires_at
                    ? t('tokens.expires', { date: new Date(tok.expires_at).toLocaleDateString() })
                    : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  title={t('tokens.copyInstallTitle')}
                  className="rounded-chip p-2 text-tide-500 hover:bg-tide-50 hover:text-tide-700"
                  onClick={() => copy(aiPrompt(), `${tok.id}:prompt`)}
                >
                  {copied === `${tok.id}:prompt` ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                </button>
                {fresh[tok.id] && (
                  <button
                    type="button"
                    title={t('tokens.copyTokenTitle')}
                    className="rounded-chip p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
                    onClick={() => copy(fresh[tok.id]!, `${tok.id}:token`)}
                  >
                    {copied === `${tok.id}:token` ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  title={t('tokens.rotateActionTitle')}
                  className="rounded-chip p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
                  onClick={() => void rotate(tok)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title={t('tokens.revokeActionTitle')}
                  className="rounded-chip p-2 text-ink-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => void revoke(tok)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
