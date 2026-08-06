import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ENTRY_FEE_TIERS } from '../../../matchmaking/config/entry-fees';
import { COLOR_PREFERENCES } from '../../../matchmaking/config/color-preference';

export class SendMatchInvitationDto {
  @IsUUID()
  recipientId: string;

  @IsString()
  timeControlId: string;

  @IsIn(ENTRY_FEE_TIERS)
  entryFee: number;

  /** Rated (default) games move Elo; casual games never touch a rating. */
  @IsOptional()
  @IsBoolean()
  rated?: boolean;

  /** The SENDER's preferred color — the recipient plays the opposite color (or a coin flip when 'random'). */
  @IsOptional()
  @IsIn(COLOR_PREFERENCES)
  colorPreference?: 'random' | 'white' | 'black';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;
}
