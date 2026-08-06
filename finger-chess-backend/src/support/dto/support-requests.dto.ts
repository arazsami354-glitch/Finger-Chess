import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject: string;

  @IsIn(['payment', 'gameplay', 'account', 'other'])
  category: string;

  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  message: string;
}

export class ReplyTicketDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message: string;
}

export class AssignTicketDto {
  @IsString()
  adminId: string;
}
