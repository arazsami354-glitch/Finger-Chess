import { IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';

export class RequestWithdrawalDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsIn(['bank_transfer', 'upi', 'paypal'])
  payoutMethod: string;
}

export class ReviewWithdrawalDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RequestRefundDto {
  @IsUUID()
  originalTransactionId: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @MaxLength(500)
  reason: string;
}

export class ReviewRefundDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';
}
