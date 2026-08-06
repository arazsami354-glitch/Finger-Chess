import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WalletService } from './wallet.service';
import { AccountingService } from './accounting/accounting.service';
import { RequestRefundDto, RequestWithdrawalDto, ReviewRefundDto, ReviewWithdrawalDto } from './dto/wallet-requests.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from '../admin/audit/admin-audit.service';
import { AgeService } from '../compliance/age.service';
import { ListDepositsQueryDto, ListWalletTransactionsQueryDto, ListWithdrawalsQueryDto } from '../admin/dto/admin-requests.dto';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
    private readonly age: AgeService,
  ) {}

  @Get('balance')
  getBalance(@CurrentUser() user: { userId: string }) {
    return this.walletService.getBalance(user.userId);
  }

  @Get('transactions')
  getTransactions(
    @CurrentUser() user: { userId: string },
    @Query('cursor') cursor?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    return this.walletService.getTransactionHistory(user.userId, { cursor, type, status, from, to, search });
  }

  @Get('transactions/export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // a full-history export is a heavier query than a normal page load — bounded separately
  async exportTransactions(
    @CurrentUser() user: { userId: string },
    @Res() res: Response,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    const transactions = await this.walletService.getTransactionsForExport(user.userId, { type, status, from, to, search });

    const header = 'Date,Type,Amount,Status,Reference\n';
    const rows = transactions
      .map((t) => {
        // Escape any field that could contain a comma/quote — a reference
        // ID or type string is attacker-adjacent-enough data (ultimately
        // derived from things like Stripe references) that CSV injection
        // hygiene is worth doing properly rather than assuming it's safe.
        const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
        return [t.createdAt.toISOString(), escape(t.type), Number(t.amount).toFixed(2), t.status, escape(t.referenceId ?? '')].join(',');
      })
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="finger-chess-transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(header + rows);
  }

  @Get('deposits')
  getMyDeposits(@CurrentUser() user: { userId: string }) {
    return this.walletService.getMyDeposits(user.userId);
  }

  @Get('withdrawals')
  getMyWithdrawals(@CurrentUser() user: { userId: string }) {
    return this.walletService.getMyWithdrawals(user.userId);
  }

  // ---------------------------------------------------------------------
  // WITHDRAWALS
  // ---------------------------------------------------------------------

  @Post('withdraw/request')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async requestWithdrawal(@CurrentUser() user: { userId: string }, @Body() dto: RequestWithdrawalDto) {
    const requester = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    if (requester.kycStatus !== 'verified') {
      throw new ForbiddenException('KYC verification required before withdrawing');
    }
    await this.age.assertRealMoneyEligible(user.userId);

    // Row creation + available->pending hold happen in one transaction, so a
    // failed hold can never leave a 'requested' withdrawal with no hold.
    return this.walletService.requestWithdrawal(user.userId, dto.amount, dto.payoutMethod);
  }

  // ---------------------------------------------------------------------
  // REFUNDS (player-initiated request; admin approval required)
  // ---------------------------------------------------------------------

  @Post('refund/request')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestRefund(@CurrentUser() user: { userId: string }, @Body() dto: RequestRefundDto) {
    return this.walletService.requestRefund(user.userId, dto.originalTransactionId, dto.amount, dto.reason);
  }
}

// ---------------------------------------------------------------------
// ADMIN — withdrawal & refund review queue
// ---------------------------------------------------------------------

@Controller('admin/wallet')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('finance_admin', 'super_admin')
export class AdminWalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly accounting: AccountingService,
  ) {}

  @Get('withdrawals/pending')
  listPendingWithdrawals() {
    return this.prisma.withdrawal.findMany({
      where: { status: 'requested' },
      orderBy: { requestedAt: 'asc' },
      include: { user: { select: { id: true, email: true, kycStatus: true } } },
    });
  }

  @Post('withdrawals/:id/review')
  async reviewWithdrawal(
    @CurrentUser() admin: { userId: string },
    @Param('id') withdrawalId: string,
    @Body() dto: ReviewWithdrawalDto,
    @Req() req: Request,
  ) {
    // The whole review — status claim + balance change — is one serializable
    // transaction inside the service, so a concurrent approve/reject can never
    // both execute (only one review can transition the row out of 'requested').
    if (dto.decision === 'approve') {
      await this.walletService.captureWithdrawal(withdrawalId, admin.userId);
    } else {
      await this.walletService.reverseWithdrawal(withdrawalId, admin.userId);
    }

    await this.audit.log({
      adminId: admin.userId,
      action: `withdrawal.${dto.decision}`,
      targetType: 'withdrawal',
      targetId: withdrawalId,
      ip: req.ip,
      newValue: dto.reason ? { reason: dto.reason } : undefined,
    });

    return { success: true };
  }

  @Get('refunds/pending')
  listPendingRefunds() {
    return this.prisma.refund.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' } });
  }

  @Post('refunds/:id/review')
  async reviewRefund(
    @CurrentUser() admin: { userId: string },
    @Param('id') refundId: string,
    @Body() dto: ReviewRefundDto,
    @Req() req: Request,
  ) {
    const result = await this.walletService.reviewRefund(refundId, admin.userId, dto.decision);
    await this.audit.log({ adminId: admin.userId, action: `refund.${dto.decision}`, targetType: 'refund', targetId: refundId, ip: req.ip });
    return result;
  }

  @Get('fraud-signals')
  listFraudSignals(@Query('status') status = 'open') {
    return this.prisma.fraudSignal.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get('reconciliation/drifts')
  listReconciliationDrifts() {
    return this.accounting.getOpenDrifts();
  }

  /** Full deposits ledger — status filter, date window, user-email search, cursor pagination. */
  @Get('deposits')
  async listDeposits(@Query() query: ListDepositsQueryDto) {
    const take = Math.min(query.take ?? 50, 200);
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.initiatedAt = {};
      if (query.from) where.initiatedAt.gte = new Date(query.from);
      if (query.to) where.initiatedAt.lte = new Date(query.to);
    }
    if (query.search) where.user = { email: { contains: query.search, mode: 'insensitive' } };

    const rows = await this.prisma.deposit.findMany({
      where,
      include: { user: { select: { id: true, email: true } } },
      orderBy: { initiatedAt: 'desc' },
      take: take + 1,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
    });
    const items = rows.slice(0, take);
    return { items, nextCursor: rows.length > take ? items[items.length - 1].id : null };
  }

  /** Full withdrawals ledger — status filter, date window, user-email search, cursor pagination. */
  @Get('withdrawals')
  async listWithdrawals(@Query() query: ListWithdrawalsQueryDto) {
    const take = Math.min(query.take ?? 50, 200);
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.requestedAt = {};
      if (query.from) where.requestedAt.gte = new Date(query.from);
      if (query.to) where.requestedAt.lte = new Date(query.to);
    }
    if (query.search) where.user = { email: { contains: query.search, mode: 'insensitive' } };

    const rows = await this.prisma.withdrawal.findMany({
      where,
      include: { user: { select: { id: true, email: true, kycStatus: true } } },
      orderBy: { requestedAt: 'desc' },
      take: take + 1,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
    });
    const items = rows.slice(0, take);
    return { items, nextCursor: rows.length > take ? items[items.length - 1].id : null };
  }

  /**
   * Wallet-ledger explorer across ALL users — the money-movement audit view.
   * A `status=failed` filter surfaces the failed-operations queue (rejected
   * captures, failed holds, reversal errors) that the dashboard card counts.
   */
  @Get('transactions')
  async listTransactions(@Query() query: ListWalletTransactionsQueryDto) {
    const take = Math.min(query.take ?? 50, 200);
    const where: any = {};
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    if (query.userId || query.search) {
      where.wallet = {
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.search ? { user: { email: { contains: query.search, mode: 'insensitive' } } } : {}),
      };
    }

    const rows = await this.prisma.walletTransaction.findMany({
      where,
      include: { wallet: { select: { user: { select: { id: true, email: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
    });
    const items = rows.slice(0, take);
    return { items, nextCursor: rows.length > take ? items[items.length - 1].id : null };
  }
}
