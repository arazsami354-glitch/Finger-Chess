import { Body, Controller, Get, Post, Req, Res, UseGuards, Delete, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor/two-factor.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ConfirmTwoFactorDto, TwoFactorLoginDto, VerifyTwoFactorDto } from './dto/two-factor.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ConfigService } from '@nestjs/config';
import { OAuthProfile } from './strategies/google.strategy';
import { REFRESH_COOKIE_NAME, parseDurationToMs, refreshCookieOptions } from './refresh-cookie.util';

/** Passport attaches whatever the strategy's `validate()` returned to `req.user` — for the OAuth routes specifically, that's always an OAuthProfile (see google.strategy.ts / discord.strategy.ts), never the JWT-derived `{userId, email, role}` shape used everywhere else. Typing this explicitly here means a mismatch between what a strategy returns and what the callback handler expects is a compile error, not a silent `any`. */
interface OAuthRequest extends Request {
  user: OAuthProfile;
}

function requestMeta(req: Request) {
  const rawDeviceLabel = req.headers['x-device-label'] as string | undefined;
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    deviceLabel: rawDeviceLabel ? rawDeviceLabel.slice(0, 100) : undefined, // defense in depth — also escaped again at render time in MailService
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactorService: TwoFactorService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Sets the refresh token as an httpOnly cookie and returns only the
   * access token (plus anything else in the result) in the JSON body —
   * the refresh token itself never appears in a response body a script
   * could read, only in a cookie JavaScript cannot access at all.
   */
  private issueTokens(res: Response, tokens: { accessToken: string; refreshToken: string }) {
    const maxAgeMs = parseDurationToMs(this.config.get<string>('jwt.refreshExpiresIn') ?? '7d');
    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions(maxAgeMs, this.config.get('nodeEnv') === 'production'));
    return { accessToken: tokens.accessToken };
  }

  // ---------------------------------------------------------------------
  // REGISTER / EMAIL VERIFICATION
  // ---------------------------------------------------------------------

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('verify-email')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(dto.email);
  }

  // ---------------------------------------------------------------------
  // LOGIN / 2FA / LOGOUT
  // ---------------------------------------------------------------------

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // brute-force protection
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto, requestMeta(req));
    if ('requiresTwoFactor' in result) return result; // no tokens yet — 2FA must complete first
    return this.issueTokens(res, result);
  }

  @Post('2fa/login-verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async loginTwoFactor(@Body() dto: TwoFactorLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.loginWithTwoFactor(dto.twoFactorSessionToken, dto.code, requestMeta(req));
    return this.issueTokens(res, result);
  }

  @Post('refresh')
  @UseGuards(AuthGuard('jwt-refresh'))
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(@CurrentUser() user: { userId: string; refreshToken: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.refreshTokens(user.userId, user.refreshToken, requestMeta(req));
    return this.issueTokens(res, result);
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt-refresh'))
  async logout(@CurrentUser() user: { userId: string; refreshToken: string }, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.logout(user.userId, user.refreshToken);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
    return result;
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  async logoutAll(@CurrentUser() user: { userId: string }, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.logoutAllDevices(user.userId);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
    return result;
  }

  // ---------------------------------------------------------------------
  // FORGOT / RESET PASSWORD
  // ---------------------------------------------------------------------

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60_000 } }) // strict — this endpoint sends email regardless of outcome
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  // ---------------------------------------------------------------------
  // 2FA MANAGEMENT (requires an authenticated session)
  // ---------------------------------------------------------------------

  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  setupTwoFactor(@CurrentUser() user: { userId: string; email: string }) {
    return this.twoFactorService.generateSetup(user.userId, user.email);
  }

  @Post('2fa/confirm')
  @UseGuards(JwtAuthGuard)
  confirmTwoFactor(@CurrentUser() user: { userId: string }, @Body() dto: ConfirmTwoFactorDto) {
    return this.twoFactorService.confirmEnable(user.userId, dto.code);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  disableTwoFactor(@CurrentUser() user: { userId: string }, @Body() dto: VerifyTwoFactorDto) {
    return this.twoFactorService.disable(user.userId, dto.code);
  }

  // ---------------------------------------------------------------------
  // SESSION / DEVICE MANAGEMENT
  // ---------------------------------------------------------------------

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  listSessions(@CurrentUser() user: { userId: string }) {
    return this.authService.listSessions(user.userId);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  revokeSession(@CurrentUser() user: { userId: string }, @Param('id') sessionId: string) {
    return this.authService.revokeSession(user.userId, sessionId);
  }

  // ---------------------------------------------------------------------
  // GOOGLE OAUTH
  // ---------------------------------------------------------------------

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {
    // Passport redirects to Google's consent screen — handler body never runs.
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: OAuthRequest, @Res() res: Response) {
    const tokens = await this.authService.loginOrRegisterOAuth(req.user, requestMeta(req));
    this.redirectWithTokens(res, tokens);
  }

  // ---------------------------------------------------------------------
  // DISCORD OAUTH
  // ---------------------------------------------------------------------

  @Get('discord')
  @UseGuards(AuthGuard('discord'))
  discordAuth() {}

  @Get('discord/callback')
  @UseGuards(AuthGuard('discord'))
  async discordCallback(@Req() req: OAuthRequest, @Res() res: Response) {
    const tokens = await this.authService.loginOrRegisterOAuth(req.user, requestMeta(req));
    this.redirectWithTokens(res, tokens);
  }

  /**
   * Redirects back to the SPA with only the ACCESS token in the URL
   * fragment (never the query string, so it doesn't land in server logs
   * or the Referer header) — the frontend route reads `window.location.hash`
   * once and immediately clears it, keeping the access token only in
   * memory from that point on, same as the regular login flow. The
   * refresh token is set as the same httpOnly cookie every other login
   * path uses, via `issueTokens` — putting it in a URL fragment instead
   * would defeat the entire point of moving it off client-readable
   * storage, since a fragment is still visible in browser history and
   * still has to pass through JS (`location.hash`) to be read at all.
   */
  private redirectWithTokens(res: Response, tokens: { accessToken: string; refreshToken: string }) {
    const { accessToken } = this.issueTokens(res, tokens);
    const frontendUrl = this.config.get<string>('frontendUrl');
    const fragment = new URLSearchParams({ access_token: accessToken }).toString();
    res.redirect(`${frontendUrl}/oauth/callback#${fragment}`);
  }
}
