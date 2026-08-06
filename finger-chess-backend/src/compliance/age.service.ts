import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const MIN_REALISTIC_AGE_YEARS = 13; // below this, the date is almost certainly a data-entry error, not a real user
const MAX_REALISTIC_AGE_YEARS = 120;

@Injectable()
export class AgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get minimumAge(): number {
    return this.config.get<number>('compliance.minimumAge')!;
  }

  /** Pure function: derives current age from a date of birth — never stored as a raw number, since that goes stale the moment a birthday passes. */
  computeAge(dateOfBirth: Date): number {
    const now = new Date();
    let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
    const hasHadBirthdayThisYear =
      now.getUTCMonth() > dateOfBirth.getUTCMonth() ||
      (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() >= dateOfBirth.getUTCDate());
    if (!hasHadBirthdayThisYear) age -= 1;
    return age;
  }

  async submitDateOfBirth(userId: string, dateOfBirthIso: string) {
    const dob = new Date(dateOfBirthIso);
    if (Number.isNaN(dob.getTime())) {
      throw new BadRequestException('Invalid date of birth');
    }
    if (dob.getTime() > Date.now()) {
      throw new BadRequestException('Date of birth cannot be in the future');
    }

    const age = this.computeAge(dob);
    if (age < MIN_REALISTIC_AGE_YEARS || age > MAX_REALISTIC_AGE_YEARS) {
      throw new BadRequestException('Please enter a valid date of birth');
    }

    // Age itself is NOT rejected for being under the platform minimum here
    // — an under-minimum-age user is still allowed to register and use free
    // features. The minimum-age gate is enforced at the point of actually
    // joining a paid match / using a money feature (see assertRealMoneyEligible
    // below), not at the point of simply telling us how old you are.
    await this.prisma.user.update({ where: { id: userId }, data: { dateOfBirth: dob } });

    return { age, meetsMinimumAge: age >= this.minimumAge };
  }

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { dateOfBirth: true } });
    return {
      hasProvidedAge: user.dateOfBirth !== null,
      age: user.dateOfBirth ? this.computeAge(user.dateOfBirth) : null,
      minimumAge: this.minimumAge,
      meetsMinimumAge: user.dateOfBirth ? this.computeAge(user.dateOfBirth) >= this.minimumAge : false,
    };
  }

  /**
   * The single gate every real-money action (paid matchmaking, deposit,
   * withdrawal, KYC submission) calls before proceeding. Throws with a
   * specific, actionable message rather than a generic 403 — the frontend
   * distinguishes "you haven't told us your age yet" (send them to the
   * age interstitial) from "you're not old enough" (a hard stop, no
   * interstitial helps).
   */
  async assertRealMoneyEligible(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { dateOfBirth: true } });
    if (!user.dateOfBirth) {
      throw new BadRequestException('Please complete your profile — we need your date of birth before you can use real-money features');
    }
    if (this.computeAge(user.dateOfBirth) < this.minimumAge) {
      throw new BadRequestException(`You must be at least ${this.minimumAge} to use real-money features`);
    }
  }
}
