import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended IV length for GCM

/**
 * "Message Encryption (where appropriate)" — applied here specifically:
 * this encrypts message CONTENT AT REST in Postgres, so a database
 * dump/leak/backup-in-the-wrong-hands doesn't hand over every user's
 * private conversation history in plaintext. It is NOT end-to-end
 * encryption — the backend itself can still read messages (required for
 * the profanity filter, spam detection, and admin moderation/report review
 * to function at all), and this is a deliberate, stated tradeoff rather
 * than an oversight: a real-money platform needs to be able to review
 * message content when a harassment report comes in, which is fundamentally
 * incompatible with true E2E encryption where even the platform can't read
 * the content. Encrypting at rest is the right scope for "where
 * appropriate" here — it stops the passive-database-leak threat without
 * blocking the active-moderation requirement this same feature set asks for.
 */
@Injectable()
export class MessageEncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get<string>('social.messageEncryptionKey');
    if (!secret) {
      throw new Error('FINGER_CHESS_MESSAGE_ENCRYPTION_KEY must be set — message content cannot be stored unencrypted');
    }
    // Derives a proper 32-byte key from whatever secret string is
    // configured, rather than requiring the operator to hand-generate and
    // manage raw key bytes.
    this.key = scryptSync(secret, 'finger-chess-message-encryption', 32);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // iv + authTag + ciphertext, concatenated and base64-encoded as one
    // opaque string — simplest thing that round-trips correctly and fits
    // in a single TEXT column.
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = raw.subarray(IV_LENGTH + 16);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
