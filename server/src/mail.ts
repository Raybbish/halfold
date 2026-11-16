/* Email: the sign-in code (phase 4). Sent through Resend (resend.com, RESEND_API_KEY and MAIL_FROM). Without a key the
   code is printed in the server's console instead, so the server can be tried on one computer without a mail account. */
import type { Config } from "./config";

export interface Mail { to: string; subject: string; text: string; html: string }
export interface Mailer { readonly provider: string; send(m: Mail): Promise<void> }

export class ResendMailer implements Mailer {
  readonly provider = "resend";
  constructor(private readonly key: string, private readonly from: string, private readonly base = "https://api.resend.com") {}
  async send(m: Mail) {
    const r = await fetch(this.base + "/emails", {
      method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, html: m.html })
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
}

/* No mail service set: the code goes to the server log. Anyone who can read that log can sign in as anyone, so this is
   for trying the server on one computer only; the start-up warning says so. */
export class ConsoleMailer implements Mailer {
  readonly provider = "console";
  async send(m: Mail) { console.log(`[mail] RESEND_API_KEY is not set, so this email was not sent. To ${m.to}: ${m.subject}`); }
}

export const createMailer = (config: Config): Mailer =>
  config.mail.resendKey ? new ResendMailer(config.mail.resendKey, config.mail.from, config.mail.apiBase) : new ConsoleMailer();

/* The sign-in email, in English and Chinese (the students' interface language is only known to their browser). */
export function codeMail(to: string, code: string, minutes: number): Mail {
  const text = `Your Halfnote sign-in code is ${code}. It works for ${minutes} minutes.\n` +
    `你的 Halfnote 登入碼是 ${code}，${minutes} 分鐘內有效。\n\n` +
    `If you did not try to sign in to Halfnote, ignore this email.\n如果你沒有登入 Halfnote，請忽略這封郵件。`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">` +
    `<p>Your Halfnote sign-in code is<br>你的 Halfnote 登入碼是</p>` +
    `<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>` +
    `<p>It works for ${minutes} minutes. ${minutes} 分鐘內有效。</p>` +
    `<p style="color:#777;font-size:13px">If you did not try to sign in to Halfnote, ignore this email. 如果你沒有登入 Halfnote，請忽略這封郵件。</p></div>`;
  return { to, subject: `${code} is your Halfnote code`, text, html };
}
