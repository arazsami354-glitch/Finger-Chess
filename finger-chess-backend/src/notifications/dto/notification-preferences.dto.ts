import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Partial update of a user's notification preferences. `categories` is a map
 * of category -> enabled; only the keys actually present are written (the
 * rest are left as-is), so the client can send a single changed toggle. All
 * keys are validated against the known category set before being persisted.
 */
export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsObject()
  categories?: Record<string, boolean>;

  @IsOptional()
  @IsBoolean()
  soundEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  desktopEnabled?: boolean;
}

export class AdminAnnounceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message: string;
}
