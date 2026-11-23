/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AgriMandi-AI Secure Email Service (Nodemailer SMTP + Optional HTTPS Resend Fallback)
 * - Credentials and tokens are never logged in production.
 * - Developer tokens are restricted strictly to non-production environments when email delivery is unconfigured.
 * - Resolves verification URLs automatically for hosted environments (APP_BASE_URL, RENDER_EXTERNAL_URL, or request Origin).
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

export function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  return Boolean(host && user && pass);
}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function isEmailDeliveryConfigured(): boolean {
  return isSmtpConfigured() || isResendConfigured();
}

/**
 * Resolves the public application base URL for email verification links.
 * Priority:
 * 1. Explicit non-localhost APP_BASE_URL (or any APP_BASE_URL if no hosted URL exists)
 * 2. RENDER_EXTERNAL_URL (automatically injected by Render)
 * 3. Incoming HTTP request origin (via trust proxy X-Forwarded-Proto/Host)
 * 4. http://localhost:3000
 */
export function resolveAppBaseUrl(requestOrigin?: string): string {
  const envBase = process.env.APP_BASE_URL?.trim().replace(/\/+$/, '');
  const renderUrl = process.env.RENDER_EXTERNAL_URL?.trim().replace(/\/+$/, '');
  const reqUrl = requestOrigin?.trim().replace(/\/+$/, '');

  const isLocalhostUrl = (url?: string) =>
    Boolean(url && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url));

  const isAiStudioPreviewUrl = (url?: string) =>
    Boolean(url && /^https:\/\/[a-z0-9.-]+\.run\.app$/i.test(url));

  // If the user is actively registering from an AI Studio Cloud Run preview URL, keep verification links on that preview origin
  if (reqUrl && isAiStudioPreviewUrl(reqUrl)) {
    return reqUrl;
  }

  if (envBase && (!isLocalhostUrl(envBase) || (!renderUrl && (!reqUrl || isLocalhostUrl(reqUrl))))) {
    return envBase;
  }
  if (renderUrl) {
    return renderUrl;
  }
  if (reqUrl) {
    return reqUrl;
  }
  return 'http://localhost:3000';
}

function buildVerificationEmailHtml(userName: string, verifyLink: string, otpCode?: string): string {
  const safeName = userName.replace(/[<>&"']/g, (ch) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch] || ch)
  );
  const safeLink = verifyLink.replace(/"/g, '&quot;');
  const safeOtp = otpCode ? otpCode.replace(/[^0-9]/g, '') : '';
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
      <h2 style="color: #059669; margin-top: 0;">AgriMandi-AI - Agricultural Market Intelligence</h2>
      <p style="color: #1e293b;">Hello <b>${safeName}</b>,</p>
      <p style="color: #334155; line-height: 1.5;">Thank you for registering with AgriMandi-AI. Click the <strong>Verify Me</strong> button below to verify your email address and unlock access to your role dashboard:</p>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${safeLink}" style="background-color: #059669; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">Verify Me</a>
      </div>
      ${
        safeOtp
          ? `<div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
               <p style="color: #475569; font-size: 13px; margin: 0 0 8px 0;">Or enter this 6-digit verification code in the app (useful in AI Studio Dev Preview):</p>
               <div style="font-family: monospace; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #059669;">${safeOtp}</div>
             </div>`
          : ''
      }
      <p style="color: #475569; font-size: 13px;">Or open this link in your browser if the button does not work:</p>
      <p style="word-break: break-all; color: #059669; font-size: 13px;"><a href="${safeLink}">${safeLink}</a></p>
      <p style="color: #64748b; font-size: 13px; margin-top: 28px;">This verification link and code expire in 24 hours. If you did not create an AgriMandi-AI account, you can safely ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="color: #94a3b8; font-size: 12px; text-align: center;">AgriMandi-AI Agricultural Intelligence Platform</p>
    </div>
  `;
}

async function sendViaResend(
  toEmail: string,
  from: string,
  subject: string,
  html: string
): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { success: false, error: 'RESEND_API_KEY not configured.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [toEmail],
        subject,
        html,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        success: false,
        error: `HTTPS email API returned status ${res.status}. Verify RESEND_API_KEY and verified sender domain.`,
      };
    }
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err?.name === 'AbortError' ? 'HTTPS email API request timed out.' : 'HTTPS email API request failed.',
    };
  } finally {
    clearTimeout(timer);
  }
}

function classifySmtpError(err: any): string {
  const code = String(err?.code || '');
  const responseCode = Number(err?.responseCode || 0);
  const message = String(err?.message || '').toLowerCase();

  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534 || message.includes('invalid login')) {
    return 'SMTP authentication failed. For Gmail, verify SMTP_USER and use a 16-character Gmail App Password (not your regular password).';
  }
  if (
    code === 'ETIMEDOUT' ||
    code === 'ESOCKET' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ENETUNREACH' ||
    message.includes('timeout')
  ) {
    return 'Could not connect to SMTP server (connection blocked or timed out). Note: Render Free tier blocks outbound SMTP ports 25/465/587; use HTTPS email API (RESEND_API_KEY) or a paid Render instance.';
  }
  return 'Failed to dispatch verification email via SMTP.';
}

export async function sendVerificationEmail(
  toEmail: string,
  verificationToken: string,
  userName: string,
  requestOrigin?: string,
  otpCode?: string
): Promise<{ success: boolean; error?: string; devToken?: string; provider?: 'smtp' | 'resend' }> {
  const isProd = process.env.NODE_ENV === 'production';
  const appBaseUrl = resolveAppBaseUrl(requestOrigin);
  const verifyLink = `${appBaseUrl}/verify-email?token=${verificationToken}`;

  const smtpUser = process.env.SMTP_USER?.trim();
  const defaultFrom = smtpUser
    ? `AgriMandi-AI Support <${smtpUser}>`
    : 'AgriMandi-AI Support <onboarding@resend.dev>';
  const from = process.env.SMTP_FROM?.trim() || defaultFrom;
  const subject = 'Verify Me - Activate your AgriMandi-AI account';
  const html = buildVerificationEmailHtml(userName, verifyLink, otpCode);

  if (!isEmailDeliveryConfigured()) {
    if (isProd) {
      console.error('[MailService] Production error: Neither SMTP nor RESEND_API_KEY is configured.');
      return {
        success: false,
        error: 'Email delivery service is not configured on the server (set SMTP_* or RESEND_API_KEY).',
      };
    }

    // Non-production development / test fallback only
    console.warn(`[MailService] SMTP unconfigured. Verification token for ${toEmail}: [REDACTED FOR SECURITY] (Dev Link: ${verifyLink})`);
    return {
      success: false,
      error: 'SMTP server is not configured in environment variables. Email delivery is unavailable.',
      devToken: verificationToken,
    };
  }

  // Prefer SMTP when configured (with fast timeouts so Render never hangs with 502)
  if (isSmtpConfigured()) {
    const host = process.env.SMTP_HOST!.trim();
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER!.trim();
    const rawPass = process.env.SMTP_PASS!.trim();
    // Gmail App Passwords are displayed in 4-char groups with spaces; strip whitespace for Gmail SMTP
    const pass = host.toLowerCase().includes('gmail') ? rawPass.replace(/\s+/g, '') : rawPass;

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        tls: { minVersion: 'TLSv1.2' },
      });

      await transporter.sendMail({ from, to: toEmail, subject, html });
      return { success: true, provider: 'smtp' };
    } catch (err: any) {
      const friendlyError = classifySmtpError(err);
      console.error('[MailService] SMTP delivery failed:', isProd ? friendlyError : err?.message);

      // Optional HTTPS fallback if RESEND_API_KEY is also configured (e.g., Render Free Tier blocks SMTP ports)
      if (isResendConfigured()) {
        const resendFrom = process.env.RESEND_FROM?.trim() || process.env.SMTP_FROM?.trim() || 'AgriMandi-AI <onboarding@resend.dev>';
        const resendResult = await sendViaResend(toEmail, resendFrom, subject, html);
        if (resendResult.success) {
          return { success: true, provider: 'resend' };
        }
      }

      return { success: false, error: friendlyError };
    }
  }

  // Direct HTTPS Resend delivery when SMTP is not set but RESEND_API_KEY is set
  const resendFrom = process.env.RESEND_FROM?.trim() || process.env.SMTP_FROM?.trim() || 'AgriMandi-AI <onboarding@resend.dev>';
  const resendResult = await sendViaResend(toEmail, resendFrom, subject, html);
  if (resendResult.success) {
    return { success: true, provider: 'resend' };
  }
  console.error('[MailService] Resend API failed:', resendResult.error);
  return { success: false, error: resendResult.error };
}
