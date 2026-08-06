import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UploadService } from './upload.service';

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('kyc')
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // KYC docs are infrequent — bounds S3 storage + moderation-review load from scripted uploads
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(), // never write untrusted uploads to local disk
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async uploadKyc(@CurrentUser() user: { userId: string }, @UploadedFile() file: Express.Multer.File) {
    const key = await this.uploadService.uploadKycDocument(user.userId, file);
    return { stored: true, key };
  }

  @Post('avatar')
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // avatar changes are infrequent by nature — bounds abuse of storage/moderation review load
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 3 * 1024 * 1024 },
    }),
  )
  async uploadAvatar(@CurrentUser() user: { userId: string }, @UploadedFile() file: Express.Multer.File) {
    const key = await this.uploadService.uploadAvatar(user.userId, file);
    const url = await this.uploadService.getAvatarUrl(key);
    return { stored: true, key, url };
  }
}
