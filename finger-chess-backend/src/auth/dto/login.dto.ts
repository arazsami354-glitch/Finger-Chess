import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(72) // mirrors the register/password-reset limit — every stored password is <= 72 chars, so a longer input is never legitimate and never needs to reach argon2
  password: string;
}
