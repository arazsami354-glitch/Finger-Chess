import { IsArray, IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class SubmitFingerprintDto {
  @IsOptional()
  @IsString()
  screenResolution?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  platform?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsArray()
  languages?: string[];

  @IsOptional()
  @IsNumber()
  hardwareConcurrency?: number;

  @IsOptional()
  @IsNumber()
  deviceMemory?: number;

  @IsOptional()
  @IsString()
  canvasHash?: string;

  @IsOptional()
  @IsString()
  audioHash?: string;

  @IsOptional()
  @IsBoolean()
  webdriver?: boolean;

  @IsOptional()
  @IsNumber()
  pluginCount?: number;

  @IsOptional()
  @IsBoolean()
  touchSupport?: boolean;
}
