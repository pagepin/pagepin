import { useState } from 'react';
import { Check, Copy, FileText } from 'lucide-react';
import { useT } from '../i18n';
import { copyText } from '../lib/format';
import { toast } from './Toast';

/** 一行装包命令；刻意不带 token —— agent 走浏览器设备登录拿 token，秘密不落聊天记录。 */
export const INSTALL_CMD = 'npx skills add pagepin/pagepin -g';

/** 部署面板里的副卡：引导用 AI agent 自助部署（装 skill 一次即可）。 */
export function AgentDeployCard() {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void copyText(INSTALL_CMD).then((ok) => {
      if (!ok) {
        toast(t('deploy.agent.copyFailed'), 'err');
        return;
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      toast(t('deploy.agent.copied'));
    });
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-ink-200 bg-white p-4">
      <div className="flex items-center gap-1.5 text-ink-700">
        <FileText className="h-3.5 w-3.5 text-ink-400" />
        <span className="text-[12.5px] font-semibold">{t('deploy.agent.heading')}</span>
      </div>
      <p className="text-xs leading-relaxed text-ink-500">{t('deploy.agent.desc')}</p>
      <div className="flex items-stretch gap-1.5 rounded-field bg-ink-900 py-1.5 pl-3 pr-1.5">
        <code className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap font-mono text-[11px] text-ink-200">
          <span className="text-tide-300">npx&nbsp;</span>skills add pagepin/pagepin -g
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex shrink-0 items-center gap-1 rounded-chip border border-white/10 bg-white/10 px-2 py-1 text-[11px] font-semibold text-ink-200 transition-colors hover:bg-white/20"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>
      <a
        href="/skill.md"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-tide-600 hover:text-tide-700"
      >
        {t('deploy.agent.fetchPrefix')}
        <span className="font-mono">/skill.md</span>
        <span className="text-ink-400">→</span>
      </a>
    </div>
  );
}
