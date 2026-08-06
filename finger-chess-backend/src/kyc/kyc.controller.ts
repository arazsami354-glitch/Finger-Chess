import { Body, Controller, Get, Param, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { KycService } from './kyc.service';
import {
  ListKycDocumentsQueryDto,
  RejectKycDocumentDto,
  RequestMoreInfoDto,
  SubmitKycDocumentDto,
  UpdateKycDocumentNotesDto,
} from './dto/kyc-requests.dto';

@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get('status')
  getStatus(@CurrentUser() user: { userId: string }) {
    return this.kyc.getMyStatus(user.userId);
  }

  @Post('documents')
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // document submission is infrequent by nature — bounds abuse of storage/review load
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  submitDocument(
    @CurrentUser() user: { userId: string },
    @Body() dto: SubmitKycDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.kyc.submitDocument(user.userId, dto.documentType, file);
  }
}

@Controller('admin/kyc')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('finance_admin', 'super_admin') // identity documents are the most sensitive user data on the platform — not opened to support_agent
export class AdminKycController {
  constructor(private readonly kyc: KycService) {}

  @Get('documents/pending')
  listPending() {
    return this.kyc.listPendingDocuments();
  }

  /** Paginated, filterable queue — status, document type, user search, cursor. */
  @Get('documents')
  list(@Query() query: ListKycDocumentsQueryDto) {
    return this.kyc.listDocuments(query);
  }

  /** Full review record: document + owner + reviewer + decision history. */
  @Get('documents/:id')
  getDetail(@Param('id') documentId: string) {
    return this.kyc.getDocumentDetail(documentId);
  }

  @Get('documents/:id/view-url')
  getViewUrl(@Param('id') documentId: string) {
    return this.kyc.getDocumentViewUrl(documentId).then((url) => ({ url }));
  }

  /** Internal review notes — admin-only, never exposed to the user. */
  @Put('documents/:id/notes')
  updateNotes(@CurrentUser() admin: { userId: string }, @Param('id') documentId: string, @Body() dto: UpdateKycDocumentNotesDto, @Req() req: Request) {
    return this.kyc.updateDocumentNotes(documentId, admin.userId, dto.notes, req.ip);
  }

  @Post('documents/:id/approve')
  approve(@CurrentUser() admin: { userId: string }, @Param('id') documentId: string, @Req() req: Request) {
    return this.kyc.approveDocument(documentId, admin.userId, req.ip);
  }

  @Post('documents/:id/reject')
  reject(
    @CurrentUser() admin: { userId: string },
    @Param('id') documentId: string,
    @Body() dto: RejectKycDocumentDto,
    @Req() req: Request,
  ) {
    return this.kyc.rejectDocument(documentId, admin.userId, dto.reason, req.ip);
  }

  @Post('documents/:id/request-info')
  requestInfo(
    @CurrentUser() admin: { userId: string },
    @Param('id') documentId: string,
    @Body() dto: RequestMoreInfoDto,
    @Req() req: Request,
  ) {
    return this.kyc.requestMoreInfo(documentId, admin.userId, dto.note, req.ip);
  }
}
