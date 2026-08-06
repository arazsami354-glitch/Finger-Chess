import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const KYC_DOCUMENT_TYPES = ['passport', 'national_id', 'drivers_license', 'health_card'] as const;

export class SubmitKycDocumentDto {
  @IsIn(KYC_DOCUMENT_TYPES)
  documentType: (typeof KYC_DOCUMENT_TYPES)[number];
}

export class RejectKycDocumentDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class RequestMoreInfoDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  note: string;
}

/**
 * Admin queue listing — status, document type, free-text search against the
 * owning user (email / full name), and cursor pagination (same convention as
 * the admin user list). `limit` is bounded so a single request can never
 * pull the whole queue into memory.
 */
export class ListKycDocumentsQueryDto {
  @IsOptional()
  @IsIn(['pending', 'needs_more_info', 'approved', 'rejected'])
  status?: 'pending' | 'needs_more_info' | 'approved' | 'rejected';

  @IsOptional()
  @IsIn(KYC_DOCUMENT_TYPES)
  documentType?: (typeof KYC_DOCUMENT_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/**
 * Internal review notes are a full-replacement field (the admin console
 * saves the whole textarea). Empty string clears the notes; MaxLength caps
 * the stored value to the column's VARCHAR(2000).
 */
export class UpdateKycDocumentNotesDto {
  @IsString()
  @MaxLength(2000)
  notes: string;
}
