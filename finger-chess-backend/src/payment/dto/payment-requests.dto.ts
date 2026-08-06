import { IsIn, IsNumber, IsPositive } from 'class-validator';

export class InitiateDepositDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsIn(['USD', 'EUR', 'GBP', 'INR'])
  currency: string;
}
