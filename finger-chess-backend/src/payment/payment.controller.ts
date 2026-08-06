import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaymentService } from './payment.service';
import { StripeProvider } from './providers/stripe.provider';
import { InitiateDepositDto } from './dto/payment-requests.dto';

@Controller('payments')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly stripe: StripeProvider,
  ) {}

  @Post('deposit/initiate')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } }) // each call creates a real Stripe PaymentIntent — bound the cost/abuse surface
  initiateDeposit(@CurrentUser() user: { userId: string }, @Body() dto: InitiateDepositDto) {
    return this.paymentService.initiateDeposit(user.userId, dto.amount, dto.currency);
  }

  /**
   * Raw body for this route is configured in main.ts (registered before the
   * global JSON parser) — required for Stripe's signature verification.
   */
  @Post('deposit/webhook')
  @SkipThrottle()
  async handleWebhook(@Req() req: Request, @Headers('stripe-signature') signature: string) {
    const event = this.stripe.constructWebhookEvent(req.body, signature);

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const intent = event.data.object as { id: string; amount: number; currency: string };
        // Stripe amounts are in the smallest currency unit (cents) — convert back.
        await this.paymentService.handleDepositWebhookSucceeded(
          intent.id,
          intent.amount / 100,
          intent.currency,
          req.ip,
        );
        break;
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object as { payment_intent: string };
        await this.paymentService.handleChargeback(dispute.payment_intent);
        break;
      }
      default:
        break; // unhandled event types are intentionally ignored, not errors
    }

    return { received: true };
  }
}
