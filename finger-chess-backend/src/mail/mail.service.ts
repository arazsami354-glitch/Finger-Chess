import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('mail.host'),
      port: this.config.get<number>('mail.port'),
      secure: false,
      auth: {
        user: this.config.get<string>('mail.user'),
        pass: this.config.get<string>('mail.password'),
      },
    });
    this.from = this.config.get<string>('mail.from')!;
  }

  /**
   * SECURITY FIX: `deviceLabel` in sendNewDeviceAlert (and any other
   * caller-supplied string reaching an HTML email body) previously went
   * straight into the template. deviceLabel is read from a
   * client-controlled `X-Device-Label` request header (see
   * auth.controller.ts) — nothing stopped it from containing
   * `<img src=x onerror=...>` or a spoofed "this is Anthropic support,
   * click here" block styled to look like the rest of the email. Escaping
   * here means every call site is safe by default rather than relying on
   * each one to remember to sanitize its own inputs.
   */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .slice(0, 200); // caller-supplied strings are also length-capped — an email body isn't the place for a header-smuggled essay
  }

  private async send(to: string, subject: string, html: string) {
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
    } catch (err) {
      // Email failures must never throw into the request path that triggered
      // them (e.g. registration should still succeed) — log and move on.
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
    }
  }

  async sendVerificationEmail(to: string, token: string) {
    const url = `${this.config.get<string>('frontendUrl')}/verify-email?token=${encodeURIComponent(token)}`;
    await this.send(
      to,
      'Verify your email',
      `<p>Welcome to Finger Chess. Click below to verify your email address:</p>
       <p><a href="${url}">${url}</a></p>
       <p>This link expires in 24 hours.</p>`,
    );
  }

  async sendPasswordResetEmail(to: string, token: string) {
    const url = `${this.config.get<string>('frontendUrl')}/reset-password?token=${encodeURIComponent(token)}`;
    await this.send(
      to,
      'Reset your password',
      `<p>We received a request to reset your password. This link expires in 30 minutes:</p>
       <p><a href="${url}">${url}</a></p>
       <p>If you didn't request this, you can safely ignore this email — your password has not been changed.</p>`,
    );
  }

  async sendNewDeviceAlert(to: string, deviceLabel: string, ipAddress: string, timestamp: Date) {
    await this.send(
      to,
      'New sign-in to your account',
      `<p>Your account was just accessed from a new device:</p>
       <ul>
         <li>Device: ${this.escapeHtml(deviceLabel)}</li>
         <li>IP address: ${this.escapeHtml(ipAddress)}</li>
         <li>Time: ${this.escapeHtml(timestamp.toISOString())}</li>
       </ul>
       <p>If this wasn't you, reset your password immediately and review your active sessions.</p>`,
    );
  }

  async sendAccountLockedAlert(to: string, unlockAt: Date) {
    await this.send(
      to,
      'Your account has been temporarily locked',
      `<p>We locked your account after too many failed login attempts.</p>
       <p>It will automatically unlock at ${this.escapeHtml(unlockAt.toISOString())}, or you can reset your password to unlock it immediately.</p>`,
    );
  }
}
