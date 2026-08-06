import { IsDateString } from 'class-validator';

export class SubmitAgeDto {
  @IsDateString({}, { message: 'dateOfBirth must be a valid date (YYYY-MM-DD)' })
  dateOfBirth: string;
}
