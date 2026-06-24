/** 按 config.mail 选 Mailer 实现(对标 storage/factory)。未配置 → undefined(不发信)。 */

import type { MailConfig } from '../config.js';
import { LogMailer, ResendMailer, type Mailer } from './index.js';

export function createMailer(mail: MailConfig | undefined): Mailer | undefined {
  if (!mail) return undefined;
  switch (mail.provider) {
    case 'resend':
      return new ResendMailer(mail.resendApiKey!, mail.from);
    case 'log':
      return new LogMailer(mail.from);
    default:
      return undefined;
  }
}
