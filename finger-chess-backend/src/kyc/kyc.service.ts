import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AgeService } from '../compliance/age.service';
import { AdminAuditService } from '../admin/audit/admin-audit.service';

const MANUAL_REVIEW_PROVIDER = 'manual';
const KYC_AUDIT_TARGET_TYPE = 'kyc_document';

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly upload: UploadService,
    private readonly notifications: NotificationsService,
    private readonly age: AgeService,
    private readonly audit: AdminAuditService,
  ) {}

  /**
   * Everything a client is ever allowed to see about a submitted document.
   * Deliberately omits `storageKey` (internal S3 object key), `provider*`
   * (verification-provider internals), and `notes` (admin-only review notes)
   * — sensitive fields must never leave the server.
   */
  private serializeDocument(document: {
    id: string;
    documentType: string;
    status: string;
    rejectionReason: string | null;
    fileName: string | null;
    fileSize: number | null;
    mimeType: string | null;
    submittedAt: Date;
    reviewedAt: Date | null;
  }) {
    return {
      id: document.id,
      documentType: document.documentType,
      status: document.status,
      rejectionReason: document.rejectionReason,
      fileName: document.fileName,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      submittedAt: document.submittedAt,
      reviewedAt: document.reviewedAt,
    };
  }

  async submitDocument(userId: string, documentType: string, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded — attach a JPEG, PNG, or PDF of your identity document');
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.kycStatus === 'verified') {
      throw new BadRequestException('Your identity is already verified');
    }

    // KYC is the entry point to money features, so it enforces the same
    // real-money eligibility gate deposits/withdrawals/paid matchmaking do —
    // a user under the minimum age (or who never provided their DOB) cannot
    // reach the document-upload stage as a back door around it.
    await this.age.assertRealMoneyEligible(userId);

    const storageKey = await this.upload.uploadKycDocument(userId, file);

    const [document] = await this.prisma.$transaction([
      this.prisma.kycDocument.create({
        data: {
          userId,
          documentType: documentType as any,
          storageKey,
          provider: MANUAL_REVIEW_PROVIDER,
          fileName: file.originalname ? file.originalname.slice(0, 255) : null,
          fileSize: file.size,
          mimeType: file.mimetype,
        },
      }),
      // Move the user's overall status to 'pending' the moment a document
      // is submitted — including on resubmission after a rejection, which
      // is exactly why this is a plain update here rather than only ever
      // firing once at account creation.
      this.prisma.user.update({ where: { id: userId }, data: { kycStatus: 'pending' } }),
    ]);

    return this.serializeDocument(document);
  }

  async getMyStatus(userId: string) {
    const [user, documents] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { kycStatus: true, preferredIdType: true } }),
      this.prisma.kycDocument.findMany({ where: { userId }, orderBy: { submittedAt: 'desc' } }),
    ]);
    return { kycStatus: user.kycStatus, preferredIdType: user.preferredIdType, documents: documents.map((d) => this.serializeDocument(d)) };
  }

  /**
   * The single gate every money feature (deposit, withdrawal, paid
   * matchmaking) calls. Kept here rather than duplicated at each call
   * site, and deliberately returns a distinct message per status so the
   * frontend can route a 'pending' user to "we're reviewing it" copy and
   * a 'not_submitted' user straight to the upload flow, rather than one
   * generic "not verified" dead end for both.
   */
  async assertVerified(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { kycStatus: true } });
    if (user.kycStatus === 'verified') return;

    const messages: Record<string, string> = {
      not_submitted: 'Please complete identity verification before using this feature',
      pending: 'Your identity verification is still under review',
      needs_more_info: 'We need a bit more information to verify your identity — please check your verification page',
      rejected: 'Your identity verification was rejected — please resubmit your documents',
    };
    throw new BadRequestException(messages[user.kycStatus] ?? 'Identity verification is required');
  }

  // ==========================================================================
  // ADMIN REVIEW
  // ==========================================================================

  /**
   * Shared queue query used by both the legacy `/documents/pending` endpoint
   * and the paginated, filterable `/documents` listing.
   */
  private buildListWhere(params: { status?: string; documentType?: string; search?: string }) {
    const where: Prisma.KycDocumentWhereInput = {};
    if (params.status) where.status = params.status as any;
    if (params.documentType) where.documentType = params.documentType as any;
    if (params.search) {
      where.user = {
        OR: [
          { email: { contains: params.search, mode: 'insensitive' } },
          { fullName: { contains: params.search, mode: 'insensitive' } },
        ],
      };
    }
    return where;
  }

  private listQuery(params: { status?: string; documentType?: string; search?: string; cursor?: string; limit?: number }) {
    const take = params.limit ?? 25;
    return this.prisma.kycDocument.findMany({
      where: this.buildListWhere(params),
      include: { user: { select: { id: true, email: true, fullName: true, dateOfBirth: true } } },
      orderBy: { submittedAt: 'desc' },
      take: take + 1,
      ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
    });
  }

  /** Backward-compatible pending-only list — returns a plain array. */
  async listPendingDocuments() {
    const rows = await this.prisma.kycDocument.findMany({
      where: { status: 'pending' },
      include: { user: { select: { id: true, email: true, fullName: true, dateOfBirth: true } } },
      orderBy: { submittedAt: 'asc' },
    });
    return rows.map((doc) => ({
      id: doc.id,
      userId: doc.userId,
      documentType: doc.documentType,
      status: doc.status,
      rejectionReason: doc.rejectionReason,
      submittedAt: doc.submittedAt,
      reviewedAt: doc.reviewedAt,
      fileName: doc.fileName,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      notes: doc.notes,
      user: doc.user,
    }));
  }

  async listDocuments(params: { status?: string; documentType?: string; search?: string; cursor?: string; limit?: number }) {
    const rows = await this.listQuery(params);
    const hasMore = rows.length > (params.limit ?? 25);
    const page = hasMore ? rows.slice(0, rows.length - 1) : rows;
    const nextCursor = hasMore ? page[page.length - 1]?.id : null;
    return { items: page, nextCursor };
  }

  async getDocumentDetail(documentId: string) {
    const document = await this.prisma.kycDocument.findUnique({
      where: { id: documentId },
      include: {
        user: { select: { id: true, email: true, fullName: true, dateOfBirth: true, countryCode: true, kycStatus: true } },
        reviewer: { select: { id: true, email: true, fullName: true } },
      },
    });
    if (!document) throw new BadRequestException('Document not found');

    const historyRows = await this.prisma.adminLog.findMany({
      where: { targetType: KYC_AUDIT_TARGET_TYPE, targetId: documentId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const adminIds = [...new Set(historyRows.map((h) => h.adminId))];
    const admins = adminIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, email: true, fullName: true } })
      : [];
    const adminMap = new Map(admins.map((a) => [a.id, a]));

    const history = historyRows.map((h) => ({
      id: h.id,
      action: h.action,
      newValue: h.newValue,
      oldValue: h.oldValue,
      createdAt: h.createdAt,
      admin: adminMap.get(h.adminId) ?? null,
    }));

    const safeDocument = {
      id: document.id,
      userId: document.userId,
      documentType: document.documentType,
      status: document.status,
      rejectionReason: document.rejectionReason,
      submittedAt: document.submittedAt,
      reviewedAt: document.reviewedAt,
      fileName: document.fileName,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      notes: document.notes,
      user: document.user,
      reviewer: document.reviewer,
    };
    return { document: safeDocument, history };
  }

  async getDocumentViewUrl(documentId: string) {
    const document = await this.prisma.kycDocument.findUniqueOrThrow({ where: { id: documentId } });
    // Reuses the same signed-URL mechanism as avatars — private bucket,
    // time-limited link, never a permanent public URL to a government ID.
    return this.upload.getAvatarUrl(document.storageKey);
  }

  async updateDocumentNotes(documentId: string, adminId: string, notes: string, ip?: string) {
    const document = await this.prisma.kycDocument.findUniqueOrThrow({ where: { id: documentId } });

    const updated = await this.prisma.kycDocument.update({ where: { id: documentId }, data: { notes } });

    await this.audit.log({
      adminId,
      action: 'kyc.update_notes',
      targetType: KYC_AUDIT_TARGET_TYPE,
      targetId: documentId,
      oldValue: { notes: document.notes ?? null },
      newValue: { notes: notes || null },
      ip,
    });

    return updated;
  }

  async approveDocument(documentId: string, adminId: string, ip?: string) {
    const document = await this.prisma.kycDocument.findUniqueOrThrow({ where: { id: documentId } });

    const [updatedDocument] = await this.prisma.$transaction([
      this.prisma.kycDocument.update({
        where: { id: documentId },
        data: { status: 'approved', reviewedBy: adminId, reviewedAt: new Date() },
      }),
      this.prisma.user.update({ where: { id: document.userId }, data: { kycStatus: 'verified' } }),
    ]);

    await this.audit.log({
      adminId,
      action: 'kyc.approve',
      targetType: KYC_AUDIT_TARGET_TYPE,
      targetId: documentId,
      oldValue: { status: document.status },
      newValue: { status: 'approved', userId: document.userId },
      ip,
    });

    await this.notifications.send(
      document.userId,
      'in_app',
      'kyc_approved',
      'Identity verified',
      'Your identity verification was approved — deposits, withdrawals, and paid matches are now available.',
    );

    return updatedDocument;
  }

  async rejectDocument(documentId: string, adminId: string, reason: string, ip?: string) {
    const document = await this.prisma.kycDocument.findUniqueOrThrow({ where: { id: documentId } });

    const [updatedDocument] = await this.prisma.$transaction([
      this.prisma.kycDocument.update({
        where: { id: documentId },
        data: { status: 'rejected', rejectionReason: reason, reviewedBy: adminId, reviewedAt: new Date() },
      }),
      this.prisma.user.update({ where: { id: document.userId }, data: { kycStatus: 'rejected' } }),
    ]);

    await this.audit.log({
      adminId,
      action: 'kyc.reject',
      targetType: KYC_AUDIT_TARGET_TYPE,
      targetId: documentId,
      oldValue: { status: document.status },
      newValue: { status: 'rejected', reason },
      ip,
    });

    await this.notifications.send(
      document.userId,
      'in_app',
      'kyc_rejected',
      'Identity verification rejected',
      `Your submitted document was rejected: ${reason}. You can resubmit at any time.`,
    );

    return updatedDocument;
  }

  /**
   * A distinct, softer outcome from a hard rejection — the document isn't
   * wrong, it's incomplete (a blurry corner, a missing back-of-card scan,
   * an expired document with no replacement flagged yet). Keeps the
   * relationship "we're still working through this together" rather than
   * "start over," while still requiring the same resubmission flow
   * (submitDocument already creates a fresh KycDocument row and flips the
   * user back to 'pending' on resubmit, so no special-casing is needed
   * there for this status).
   */
  async requestMoreInfo(documentId: string, adminId: string, note: string, ip?: string) {
    const document = await this.prisma.kycDocument.findUniqueOrThrow({ where: { id: documentId } });

    const [updatedDocument] = await this.prisma.$transaction([
      this.prisma.kycDocument.update({
        where: { id: documentId },
        // Reuses the `rejectionReason` column as a general reviewer-note
        // field rather than adding a near-duplicate column — it means
        // "the reviewer's written reason this document isn't resolved
        // yet" either way, whether the outcome is a rejection or a
        // request for more information.
        data: { status: 'needs_more_info', rejectionReason: note, reviewedBy: adminId, reviewedAt: new Date() },
      }),
      this.prisma.user.update({ where: { id: document.userId }, data: { kycStatus: 'needs_more_info' } }),
    ]);

    await this.audit.log({
      adminId,
      action: 'kyc.request_more_info',
      targetType: KYC_AUDIT_TARGET_TYPE,
      targetId: documentId,
      oldValue: { status: document.status },
      newValue: { status: 'needs_more_info', note },
      ip,
    });

    await this.notifications.send(
      document.userId,
      'in_app',
      'kyc_needs_more_info',
      'More information needed',
      `We need a bit more to verify your identity: ${note}`,
    );

    return updatedDocument;
  }
}
