import { IsEmail, IsString, MinLength, MaxLength, Matches, IsOptional, IsDateString, IsIn } from 'class-validator';

const ID_TYPES = ['passport', 'national_id', 'drivers_license', 'health_card'] as const;

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt/argon2 input limit safety
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain upper, lower case letters and a number',
  })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2) // two-letter ISO code — matches the update-profile path's own limit
  countryCode?: string;

  @IsOptional()
  @IsDateString({}, { message: 'dateOfBirth must be a valid date (YYYY-MM-DD)' })
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(ID_TYPES)
  preferredIdType?: (typeof ID_TYPES)[number];
}
