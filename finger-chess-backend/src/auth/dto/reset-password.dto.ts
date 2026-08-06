import { IsString, Matches, MinLength, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  // Tokens are always 32 random bytes hex-encoded (64 chars) — see auth.service.ts forgotPassword.
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain upper, lower case letters and a number',
  })
  newPassword: string;
}
