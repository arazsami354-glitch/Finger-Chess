import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  MAX_ENTRY_FEE,
  MAX_PRIZE_SPOTS,
  TOURNAMENT_ENTRY_TYPES,
  TOURNAMENT_FORMATS,
  TOURNAMENT_SEEDING_MODES,
  TOURNAMENT_VISIBILITIES,
} from '../tournament.constants';

export class CreateTournamentDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsIn(TOURNAMENT_FORMATS)
  format: string;

  @IsIn(TOURNAMENT_VISIBILITIES)
  visibility: string;

  @IsIn(TOURNAMENT_ENTRY_TYPES)
  entryType: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_ENTRY_FEE)
  entryFee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  prizePool?: number;

  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(512)
  maxPlayers: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(512)
  minPlayers?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  registrationDeadline?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startTime?: Date;

  @IsString()
  timeControl: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  rules?: string;

  @ValidateIf((o) => o.format === 'swiss')
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  rounds?: number;

  @IsOptional()
  @IsIn(TOURNAMENT_SEEDING_MODES)
  seeding?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRIZE_SPOTS)
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  @Max(100, { each: true })
  prizeDistribution?: number[];
}

export class UpdateTournamentDto extends CreateTournamentDto {}

export class CancelTournamentDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}


