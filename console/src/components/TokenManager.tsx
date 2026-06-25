import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../api';
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

/** API token 列表 + 创建 + 复制/轮换/吊销 —— 不带任何外框，供 TokenDialog 与 Settings 复用。 */
export function TokenManager() {
  const [tokens, setTokens] = useState<TokenItem[] | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  /** 最近一次复制动作标识（"<id>:token" / "<id>:prompt"），用于打勾反馈 */
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, key: string) => {
    void copyText(text).then((ok) => {
      if (ok) {
        setCopied(key);
        window.setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 1500);
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

  return (
    <div>
      <p className="text-xs leading-relaxed text-ink-400">
        Deploy credentials for agents &amp; CI, scoped to your sites. The{' '}
        <Sparkles className="inline h-3 w-3 -translate-y-px text-tide-500" /> button copies the
        one-line{' '}
        <a href="https://github.com/vercel-labs/skills" target="_blank" rel="noreferrer" className="text-tide-600 underline">
          npx skills
        </a>{' '}
        install command (or read the{' '}
        <a href="/skill.md" target="_blank" rel="noreferrer" className="text-tide-600 underline">
          skill guide
        </a>
        ). The token stays out of it — the agent gets it via browser login, so it never lands in a chat.
      </p>

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
          Create token
        </button>
      </div>

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
                <div className="truncate font-mono text-xs text-ink-400">
                  {t.token
                    ? `${t.prefix}●●●●●●●●●●`
                    : `${t.prefix}… (legacy token — can't be shown; revoke & recreate)`}
                </div>
                <div className="text-xs text-ink-300">
                  {t.last_used_at ? `Last used ${formatRelative(t.last_used_at)}` : 'Never used'}
                  {t.expires_at ? ` · expires ${new Date(t.expires_at).toLocaleDateString()}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  title="Copy install command (token-free)"
                  className="rounded-chip p-2 text-tide-500 hover:bg-tide-50 hover:text-tide-700"
                  onClick={() => copy(aiPrompt(), `${t.id}:prompt`)}
                >
                  {copied === `${t.id}:prompt` ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                </button>
                {t.token && (
                  <>
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
  );
}
