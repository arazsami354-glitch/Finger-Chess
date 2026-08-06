/**
 * Finger Chess — backend configuration loader.
 *
 * Environment variable naming convention: every Finger Chess-specific
 * variable is prefixed FINGER_CHESS_, per the project's environment
 * prefix standard. Three variables are deliberately left UNPREFIXED
 * because they follow universal Node.js/platform conventions that
 * tooling and hosting providers depend on by exact name, not because
 * they were missed:
 *   - NODE_ENV   — read by Node itself and by countless libraries directly
 *   - PORT       — most PaaS providers (Railway, Render, Heroku, Cloud Run)
 *                  inject this exact name to tell the app which port to bind
 *   - DATABASE_URL — Prisma's own convention, and several managed Postgres
 *                  add-ons (e.g. Heroku Postgres) auto-inject this exact name
 * Prefixing these three would either break that tooling integration or
 * require extra glue code with no real benefit — see .env.example for the
 * same reasoning restated next to the values themselves.
 */
export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  jwt: {
    accessSecret: process.env.FINGER_CHESS_JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.FINGER_CHESS_JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.FINGER_CHESS_JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.FINGER_CHESS_JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  redis: {
    host: process.env.FINGER_CHESS_REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.FINGER_CHESS_REDIS_PORT ?? '6379', 10),
    password: process.env.FINGER_CHESS_REDIS_PASSWORD || undefined,
  },

  stripe: {
    secretKey: process.env.FINGER_CHESS_STRIPE_SECRET_KEY,
    webhookSecret: process.env.FINGER_CHESS_STRIPE_WEBHOOK_SECRET,
  },

  s3: {
    region: process.env.FINGER_CHESS_AWS_REGION,
    bucket: process.env.FINGER_CHESS_AWS_S3_BUCKET,
    accessKeyId: process.env.FINGER_CHESS_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.FINGER_CHESS_AWS_SECRET_ACCESS_KEY,
  },

  frontendUrl: process.env.FINGER_CHESS_FRONTEND_URL ?? 'http://localhost:5173',
  apiBaseUrl: process.env.FINGER_CHESS_API_BASE_URL ?? 'http://localhost:3000',

  google: {
    clientId: process.env.FINGER_CHESS_GOOGLE_CLIENT_ID,
    clientSecret: process.env.FINGER_CHESS_GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.FINGER_CHESS_GOOGLE_CALLBACK_URL,
  },

  discord: {
    clientId: process.env.FINGER_CHESS_DISCORD_CLIENT_ID,
    clientSecret: process.env.FINGER_CHESS_DISCORD_CLIENT_SECRET,
    callbackUrl: process.env.FINGER_CHESS_DISCORD_CALLBACK_URL,
  },

  twoFactor: {
    appName: process.env.FINGER_CHESS_TWO_FACTOR_APP_NAME ?? 'Finger Chess',
  },

  lockout: {
    maxFailedAttempts: parseInt(process.env.FINGER_CHESS_MAX_FAILED_LOGIN_ATTEMPTS ?? '5', 10),
    lockMinutes: parseInt(process.env.FINGER_CHESS_ACCOUNT_LOCK_MINUTES ?? '15', 10),
  },

  mail: {
    host: process.env.FINGER_CHESS_MAIL_HOST,
    port: parseInt(process.env.FINGER_CHESS_MAIL_PORT ?? '587', 10),
    user: process.env.FINGER_CHESS_MAIL_USER,
    password: process.env.FINGER_CHESS_MAIL_PASSWORD,
    from: process.env.FINGER_CHESS_MAIL_FROM ?? '"Finger Chess" <no-reply@fingerchess.com>',
  },

  social: {
    messageEncryptionKey: process.env.FINGER_CHESS_MESSAGE_ENCRYPTION_KEY,
  },

  compliance: {
    minimumAge: parseInt(process.env.FINGER_CHESS_MINIMUM_AGE ?? '18', 10),
    platformRulesVersion: process.env.FINGER_CHESS_PLATFORM_RULES_VERSION ?? '1.0',
    penaltyCheatingSuspensionHours: parseInt(process.env.FINGER_CHESS_PENALTY_CHEATING_SUSPENSION_HOURS ?? '168', 10), // 7 days
    penaltyChatAbuseMuteHours: parseInt(process.env.FINGER_CHESS_PENALTY_CHAT_ABUSE_MUTE_HOURS ?? '72', 10), // 3 days
  },

  tournament: {
    // How often the scheduler scans for due tournaments and resolves
    // no-shows. Keep coarse enough to be cheap at scale — tournament games
    // start through the event-driven path, not this sweep.
    sweepIntervalMs: parseInt(process.env.FINGER_CHESS_TOURNAMENT_SWEEP_MS ?? '30000', 10),
    // How long a tournament match's game may sit waiting for BOTH players to
    // join before the no-show rule awards a walkover to whoever did show up.
    matchStartGraceMs: parseInt(process.env.FINGER_CHESS_TOURNAMENT_MATCH_GRACE_MS ?? '300000', 10),
  },

  // --------------------------------------------------------------------
  // FAIR PLAY & ANTI-CHEAT — every weight and threshold the detection and
  // risk-scoring engines use. All overridable via FINGER_CHESS_* env vars;
  // these are documented starting points a security team tunes against real
  // outcome data, never auto-punish on their own (everything flags for
  // human review).
  // --------------------------------------------------------------------
  fairplay: {
    // Risk scoring — each open detection signal contributes points based on
    // its severity, with optional per-type overrides below. Caps bound how
    // much any single category can dominate the 0-100 score.
    severityPoints: {
      low: Number(process.env.FINGER_CHESS_FP_SEVERITY_LOW ?? '4'),
      medium: Number(process.env.FINGER_CHESS_FP_SEVERITY_MEDIUM ?? '10'),
      high: Number(process.env.FINGER_CHESS_FP_SEVERITY_HIGH ?? '22'),
      critical: Number(process.env.FINGER_CHESS_FP_SEVERITY_CRITICAL ?? '40'),
    },
    // Per-signal-type point overrides (added on top of severity points) for
    // the most damning signals; any signal type not listed falls back to its
    // severity default. Keys match the real fraud_signals.signal_type strings.
    signalTypeBonus: {
      chargeback: Number(process.env.FINGER_CHESS_FP_BONUS_CHARGEBACK ?? '15'),
      fairplay_collusion: Number(process.env.FINGER_CHESS_FP_BONUS_COLLUSION ?? '12'),
      multi_account_device: Number(process.env.FINGER_CHESS_FP_BONUS_MULTI_ACCOUNT ?? '12'),
    },
    // Category caps (max points a category can contribute before clamping).
    capPerCategory: {
      flaggedAnticheat: Number(process.env.FINGER_CHESS_FP_CAP_ANTICHEAT ?? '75'),
      openSignals: Number(process.env.FINGER_CHESS_FP_CAP_SIGNALS ?? '80'),
      cheatingPenalty: Number(process.env.FINGER_CHESS_FP_CAP_PENALTY ?? '70'),
      playerReport: Number(process.env.FINGER_CHESS_FP_CAP_REPORTS ?? '40'),
      linkedAccounts: Number(process.env.FINGER_CHESS_FP_CAP_LINKED ?? '60'),
      sharedIp: Number(process.env.FINGER_CHESS_FP_CAP_SHARED_IP ?? '15'),
      tamperFlags: Number(process.env.FINGER_CHESS_FP_CAP_TAMPER ?? '45'),
    },
    // Per-unit weights for the non-signal components.
    weights: {
      flaggedAnticheat: Number(process.env.FINGER_CHESS_FP_W_ANTICHEAT ?? '25'),
      cheatingPenalty: Number(process.env.FINGER_CHESS_FP_W_PENALTY ?? '35'),
      playerReport: Number(process.env.FINGER_CHESS_FP_W_REPORT ?? '8'),
      linkedAccount: Number(process.env.FINGER_CHESS_FP_W_LINKED ?? '20'),
      sharedIpCluster: Number(process.env.FINGER_CHESS_FP_W_SHARED_IP ?? '15'),
      tamperFlag: Number(process.env.FINGER_CHESS_FP_W_TAMPER ?? '15'),
    },
    autoFlagThreshold: Number(process.env.FINGER_CHESS_FP_AUTO_FLAG_THRESHOLD ?? '50'),
    tiers: { medium: 25, high: 50, critical: 75 },
    scoreCacheTtlSec: Number(process.env.FINGER_CHESS_FP_SCORE_CACHE_TTL ?? '300'),
    evidenceWindowDays: Number(process.env.FINGER_CHESS_FP_EVIDENCE_WINDOW_DAYS ?? '30'),

    // Detection thresholds.
    timingMinMoves: Number(process.env.FINGER_CHESS_FP_TIMING_MIN_MOVES ?? '15'),
    timingLowVariance: Number(process.env.FINGER_CHESS_FP_TIMING_LOW_VARIANCE ?? '0.15'),
    impossibleMoveSpeedMs: Number(process.env.FINGER_CHESS_FP_IMPOSSIBLE_SPEED_MS ?? '150'),
    impossibleMoveSpeedMinCount: Number(process.env.FINGER_CHESS_FP_IMPOSSIBLE_SPEED_MIN_COUNT ?? '10'),
    impossibleMoveSpeedFraction: Number(process.env.FINGER_CHESS_FP_IMPOSSIBLE_SPEED_FRACTION ?? '0.3'),
    impossibleMoveSpeedFractionFast: Number(process.env.FINGER_CHESS_FP_IMPOSSIBLE_SPEED_FRACTION_FAST ?? '0.5'),
    impossibleMoveSpeedFastBaseSec: Number(process.env.FINGER_CHESS_FP_IMPOSSIBLE_SPEED_FAST_BASE_SEC ?? '300'),
    rapidReconnectWindowSec: Number(process.env.FINGER_CHESS_FP_RECONNECT_WINDOW_SEC ?? '60'),
    rapidReconnectThreshold: Number(process.env.FINGER_CHESS_FP_RECONNECT_THRESHOLD ?? '5'),
    winStreakThreshold: Number(process.env.FINGER_CHESS_FP_WIN_STREAK_THRESHOLD ?? '12'),
    repeatedPatternWindowDays: Number(process.env.FINGER_CHESS_FP_REPEATED_WINDOW_DAYS ?? '30'),
    repeatedPatternSignalThreshold: Number(process.env.FINGER_CHESS_FP_REPEATED_SIGNAL_THRESHOLD ?? '5'),
    repeatedPatternFlaggedReports: Number(process.env.FINGER_CHESS_FP_REPEATED_FLAGGED_REPORTS ?? '3'),
    abandonmentWindowDays: Number(process.env.FINGER_CHESS_FP_ABANDON_WINDOW_DAYS ?? '14'),
    abandonmentThreshold: Number(process.env.FINGER_CHESS_FP_ABANDON_THRESHOLD ?? '3'),
    abandonmentLossRatio: Number(process.env.FINGER_CHESS_FP_ABANDON_LOSS_RATIO ?? '0.4'),
    concurrentGamesThreshold: Number(process.env.FINGER_CHESS_FP_CONCURRENT_THRESHOLD ?? '2'),
    drawOfferSpamThreshold: Number(process.env.FINGER_CHESS_FP_DRAW_OFFER_SPAM_THRESHOLD ?? '3'),
    disconnectPressureMs: Number(process.env.FINGER_CHESS_FP_DISCONNECT_PRESSURE_MS ?? '30000'),
    disconnectAfterOpponentMoveMs: Number(process.env.FINGER_CHESS_FP_DISCONNECT_AFTER_OPPONENT_MOVE_MS ?? '3000'),
    sharedIpAccountThreshold: Number(process.env.FINGER_CHESS_FP_SHARED_IP_ACCOUNT_THRESHOLD ?? '4'),
  },
});
