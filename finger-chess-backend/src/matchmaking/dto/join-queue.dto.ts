import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { ENTRY_FEE_TIERS } from '../config/entry-fees';
import { COLOR_PREFERENCES } from '../config/color-preference';

export class JoinQueueDto {
  @IsString()
  timeControlId: string;

  @IsIn(ENTRY_FEE_TIERS)
  entryFee: number;

  /** Rated (default) games move Elo; casual games never touch a rating. */
  @IsOptional()
  @IsBoolean()
  rated?: boolean;

  /** The color this player prefers to play (random = no preference). */
  @IsOptional()
  @IsIn(COLOR_PREFERENCES)
  colorPreference?: 'random' | 'white' | 'black';
}
