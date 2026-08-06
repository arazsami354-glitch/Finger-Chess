import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.userId) return false;

    // Re-read the role from the DB instead of trusting the JWT `role` claim:
    // an access token issued before an admin was demoted (or an account was
    // deactivated) keeps its stale role claim for the token's remaining
    // lifetime, which could be up to 15 minutes. Only the live DB role
    // decides, so a demotion takes effect on the very next admin request.
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { role: true },
    });
    if (!dbUser) return false;

    return requiredRoles.includes(dbUser.role);
  }
}
