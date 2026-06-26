import { useState } from 'react';
import { Check, Copy, FileText } from 'lucide-react';
import { copyText } from '../lib/format';
import { toast } from './Toast';

/** 一行装包命令；刻意不带 token —— agent 走浏览器设备登录拿 token，秘密不落聊天记录。 */
export const INSTALL_CMD = 'npx skills add pagepin/pagepin -g';

/** 部署面板里的副卡：引导用 AI agent 自助部署（装 skill 一次即可）。 */
export function AgentDeployCard() {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void copyText(INSTALL_CMD).then((ok) => {
      if (!ok) {
        toast('Copy failed — copy it manually', 'err');
        return;
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      toast('Copied — run it in your terminal');
    });
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-ink-200 bg-white p-4">
      <div className="flex items-center gap-1.5 text-ink-700">
        <FileText className="h-3.5 w-3.5 text-ink-400" />
        <span className="text-[12.5px] font-semibold">Let your AI agent deploy</span>
      </div>
      <p className="text-xs leading-relaxed text-ink-500">
        Install the skill once and your agent deploys, updates and resolves comments on its own —
        browser login, no token to paste.
      </p>
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
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <a
        href="/skill.md"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-tide-600 hover:text-tide-700"
      >
        No local skill? Fetch <span className="font-mono">/skill.md</span>
        <span className="text-ink-400">→</span>
      </a>
    </div>
  );
}
