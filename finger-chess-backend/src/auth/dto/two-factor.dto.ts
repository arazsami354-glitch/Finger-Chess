import { IsString, Length } from 'class-validator';

export class ConfirmTwoFactorDto {
  @IsString()
  @Length(6, 6)
  code: string;
}

export class VerifyTwoFactorDto {
  @IsString()
  code: string;
}

export class TwoFactorLoginDto {
  @IsString()
  twoFactorSessionToken: string; // short-lived token issued after password step succeeds

  @IsString()
  code: string;
}
