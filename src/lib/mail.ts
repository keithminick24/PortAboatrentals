import "server-only";
import nodemailer from "nodemailer";

type Mail = { to: string; subject: string; html: string; text?: string };

let transport: nodemailer.Transporter | null = null;

export async function sendMail(m: Mail): Promise<void> {
  if (!process.env.SMTP_HOST) {
    console.log(`\n[email:dev] To: ${m.to}\nSubject: ${m.subject}\n${m.text ?? m.html.replace(/<[^>]+>/g, "")}\n`);
    return;
  }
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  try {
    await transport.sendMail({ from: process.env.EMAIL_FROM, ...m });
  } catch (e) {
    // Never let an email failure break a booking flow
    console.error("[email] send failed", e);
  }
}

/**
 * Absolute link for emails, texts and redirects.
 * Uses APP_URL when it's a real address. While testing on a computer (APP_URL is
 * localhost or unset) it uses the address the page was actually opened with, so
 * links work from a phone on the same Wi-Fi (e.g. http://192.168.1.20:3000).
 */
export async function appUrl(path = "") {
  const configured = (process.env.APP_URL || "").replace(/\/$/, "");
  if (configured && !/\/\/(localhost|127\.0\.0\.1)(:|$)/.test(configured)) return configured + path;
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
      const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
      return `${proto}://${host}${path}`;
    }
  } catch {
    // Not inside a request (e.g. scheduled job): fall back below.
  }
  return (configured || "http://localhost:3000") + path;
}

export function emailLayout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#F6EFE3;font-family:Helvetica,Arial,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#0B2E4F;color:#fff;padding:18px 24px;border-radius:12px 12px 0 0;font-size:20px;font-weight:bold">Port A Boat Rentals</div>
<div style="background:#fff;padding:24px;border-radius:0 0 12px 12px">
<h2 style="margin-top:0;color:#0B2E4F">${title}</h2>${body}
</div>
<p style="font-size:12px;color:#6b7280;text-align:center">Port A Boat Rentals · Port Aransas, TX · 361-339-2628</p>
</div></body></html>`;
}
