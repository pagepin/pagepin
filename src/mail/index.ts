/** 邮件发送 —— 可插拔 Mailer(对标 storage 的接口注入)。edge-safe:只用 fetch。
 *
 * - ResendMailer:Resend HTTP API(https://resend.com),Node 与 Workers 都能用(纯 fetch)。
 * - LogMailer:把邮件打到日志(自托管未接邮件商时的兜底;验证链接可从日志取)。
 * 未配置(PAGEPIN_MAIL_PROVIDER 未设/none)时 factory 返回 undefined → 不发信、邮箱保持未验证(安全降级)。
 * SMTP 需 node-only 库、非 edge-safe,故暂不内置;需要时再加一个实现即可(接口不变)。 */

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

const TIMEOUT_MS = 15_000;

/** Resend(https://api.resend.com/emails)。apiKey 走 secret;from 须是已验证发件域的地址。 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(msg: MailMessage): Promise<void> {
    let resp: Response;
    try {
      resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: this.from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          ...(msg.text ? { text: msg.text } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error('Resend 请求失败');
    }
    if (!resp.ok) throw new Error(`Resend 返回 HTTP ${resp.status}`);
  }
}

/** 兜底:把邮件内容打日志(自托管未接邮件商时,从日志拿验证链接)。 */
export class LogMailer implements Mailer {
  constructor(private readonly from: string) {}

  async send(msg: MailMessage): Promise<void> {
    console.log(
      `[mail:log] from=${this.from} to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${msg.text ?? msg.html}`,
    );
  }
}
