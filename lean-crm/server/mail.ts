import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';
import { SMTP_URL, MAIL_FROM, OUTBOX_DIR } from './config.js';

type Mail = { to: string; subject: string; text: string; html?: string; attachments?: { filename: string; content: Buffer }[] };

/** Send via SMTP when configured; otherwise save an .eml to data/outbox so nothing is silently lost. */
export async function sendMail(m: Mail): Promise<{ delivered: boolean; file?: string }> {
  if (SMTP_URL) {
    await nodemailer.createTransport(SMTP_URL).sendMail({ from: MAIL_FROM, ...m });
    return { delivered: true };
  }
  const info = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' }).sendMail({ from: MAIL_FROM, ...m });
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  const file = path.join(OUTBOX_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${m.to.replace(/[^a-z0-9@.]/gi, '_')}.eml`);
  fs.writeFileSync(file, info.message as Buffer);
  return { delivered: false, file };
}
