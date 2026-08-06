import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class BanUserDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class UnbanUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SuspendUserDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsISO8601()
  until?: string; // omit to use the category's configured default duration (or indefinite for 'other')

  @IsOptional()
  @IsIn(['cheating', 'chat_abuse', 'fraud', 'other'])
  category?: 'cheating' | 'chat_abuse' | 'fraud' | 'other';
}

export class MuteChatDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsIn(['cheating', 'chat_abuse', 'fraud', 'other'])
  category?: 'cheating' | 'chat_abuse' | 'fraud' | 'other';

  @IsOptional()
  @IsNumber()
  @IsPositive()
  durationHours?: number;
}

export class ReactivateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListUsersQueryDto {
  @IsOptional()
  @IsIn(['active', 'suspended', 'banned', 'deleted'])
  status?: string;

  @IsOptional()
  @IsIn(['not_submitted', 'pending', 'needs_more_info', 'verified', 'rejected'])
  kycStatus?: string;

  @IsOptional()
  @IsIn(['support_agent', 'moderator', 'finance_admin', 'super_admin'])
  role?: string;

  @IsOptional()
  @IsIn(['verified', 'unverified'])
  emailVerified?: string;

  @IsOptional()
  @IsString()
  search?: string; // matches email or full name, case-insensitive

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  take?: number;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  countryCode?: string;
}

export class CancelGameDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateTicketNotesDto {
  @IsString()
  @MaxLength(5000)
  notes: string;
}

export class UpdateTicketPriorityDto {
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export class ListDepositsQueryDto {
  @IsOptional()
  @IsString()
  status?: string; // initiated | success | failed | cancelled (payment-gateway driven)

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  search?: string; // user email

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  take?: number;
}

export class ListWithdrawalsQueryDto {
  @IsOptional()
  @IsString()
  status?: string; // requested | completed | rejected

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  search?: string; // user email

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  take?: number;
}

export class ListWalletTransactionsQueryDto {
  @IsOptional()
  @IsString()
  type?: string; // TxnType

  @IsOptional()
  @IsString()
  status?: string; // TxnStatus

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  search?: string; // user email

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  take?: number;
}

export class ReviewAnticheatDto {
  @IsIn(['reviewed_clean', 'confirmed_cheating'])
  decision: 'reviewed_clean' | 'confirmed_cheating';
}

export class ReviewFairPlaySignalDto {
  @IsIn(['reviewed', 'dismissed', 'confirmed'])
  decision: 'reviewed' | 'dismissed' | 'confirmed';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class AddFairPlayNoteDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  note: string;
}

export class FairPlayPlayerReviewDto {
  @IsIn(['reviewed', 'actioned'])
  decision: 'reviewed' | 'actioned';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
