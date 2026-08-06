import { IsString, Matches } from 'class-validator';

export class VerifyEmailDto {
  // Tokens are always 32 random bytes hex-encoded (64 chars) — see auth.service.ts issueEmailVerificationToken.
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  token: string;
}
