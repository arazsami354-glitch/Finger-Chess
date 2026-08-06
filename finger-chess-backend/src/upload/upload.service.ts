import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const ALLOWED_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_AVATAR_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB — avatars don't need KYC-document-sized allowances
const AVATAR_URL_TTL_SEC = 3600;

/**
 * A client's declared `Content-Type` / the file's extension are both
 * entirely attacker-controlled — trivial to spoof by renaming a file or
 * hand-editing the multipart request. Verifying the actual leading bytes
 * against each format's known magic number means a file claiming to be a
 * harmless JPEG but actually containing, say, an executable or an HTML
 * payload (for a stored-XSS-via-"image" attack if ever served back without
 * a strict Content-Type) is rejected before it ever reaches S3, not just
 * trusted because its filename ends in .jpg.
 */
function matchesDeclaredFileType(buffer: Buffer, mimetype: string): boolean {
  if (buffer.length < 4) return false;

  switch (mimetype) {
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    case 'image/webp':
      return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'application/pdf':
      return buffer.subarray(0, 4).toString('ascii') === '%PDF';
    default:
      return false;
  }
}

@Injectable()
export class UploadService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.s3 = new S3Client({
      region: this.config.get<string>('s3.region'),
      credentials: {
        accessKeyId: this.config.get<string>('s3.accessKeyId')!,
        secretAccessKey: this.config.get<string>('s3.secretAccessKey')!,
      },
    });
    this.bucket = this.config.get<string>('s3.bucket')!;
  }

  async uploadKycDocument(userId: string, file: Express.Multer.File): Promise<string> {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Unsupported file type');
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('File exceeds maximum size of 8MB');
    }
    if (!matchesDeclaredFileType(file.buffer, file.mimetype)) {
      throw new BadRequestException('File content does not match its declared type');
    }

    const key = `kyc/${userId}/${randomUUID()}-${this.sanitizeFilename(file.originalname)}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ServerSideEncryption: 'aws:kms',
      }),
    );

    return key; // store this key in kyc_records, never a public URL
  }

  /**
   * Avatars are stored the same way KYC docs are (private bucket, signed
   * URLs on read) rather than a public bucket/CDN URL — consistent
   * security posture across every upload type, and it means switching
   * storage providers or adding moderation-hold-before-display later needs
   * no client-facing URL scheme change.
   */
  async uploadAvatar(userId: string, file: Express.Multer.File): Promise<string> {
    if (!ALLOWED_AVATAR_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Avatar must be a JPEG, PNG, or WebP image');
    }
    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      throw new BadRequestException('Avatar image exceeds maximum size of 3MB');
    }
    if (!matchesDeclaredFileType(file.buffer, file.mimetype)) {
      throw new BadRequestException('File content does not match its declared type');
    }

    const key = `avatars/${userId}/${randomUUID()}.${file.mimetype.split('/')[1]}`;

    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: file.buffer, ContentType: file.mimetype }),
    );

    await this.prisma.user.update({ where: { id: userId }, data: { avatarKey: key } });
    return key;
  }

  /** Resolves a stored avatar key to a time-limited signed URL — never a permanent public link. */
  async getAvatarUrl(avatarKey: string | null): Promise<string | null> {
    if (!avatarKey) return null;
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: avatarKey });
    return getSignedUrl(this.s3, command, { expiresIn: AVATAR_URL_TTL_SEC });
  }

  /**
   * `file.originalname` is entirely client-controlled. Used raw, it could
   * inject path-like sequences (`../../`), null bytes, or newlines into the
   * S3 key — S3 doesn't have real directories so classic path traversal
   * doesn't apply the way it would on a filesystem, but a crafted name could
   * still break downstream tooling that parses the key (log lines,
   * Content-Disposition headers if ever served, admin tooling that displays
   * it) or simply be absurdly long. Strip to a safe character set and cap
   * the length before it becomes part of anything persisted.
   */
  private sanitizeFilename(name: string): string {
    const safe = name
      .normalize('NFKC')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/^\.+/, '') // no leading dots (hidden-file-style names)
      .slice(0, 100);
    return safe.length > 0 ? safe : 'document';
  }
}
