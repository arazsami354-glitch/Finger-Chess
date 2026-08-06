-- ============================================================================
-- MIGRATION 0002: WALLET SYSTEM — pending balance, fraud, accounting, refunds
-- ============================================================================

-- 1. Extend txn_type with withdrawal hold/reversal and fraud-hold states.
ALTER TYPE txn_type ADD VALUE IF NOT EXISTS 'withdrawal_hold';
ALTER TYPE txn_type ADD VALUE IF NOT EXISTS 'withdrawal_reversal';
ALTER TYPE txn_type ADD VALUE IF NOT EXISTS 'fraud_hold';

-- 2. Add pending_balance to wallets — funds held during withdrawal review,
--    distinct from locked_balance (which is match-entry escrow).
ALTER TABLE wallets
    ADD COLUMN IF NOT EXISTS pending_balance NUMERIC(18,2) DEFAULT 0.00 NOT NULL;

ALTER TABLE wallets
    ADD CONSTRAINT chk_pending_nonneg CHECK (pending_balance >= 0);

-- 3. Withdrawals: encrypted payout details column (added if the original
--    table predates it).
ALTER TABLE withdrawals
    ADD COLUMN IF NOT EXISTS payout_details_encrypted BYTEA;

-- ============================================================================
-- FRAUD SIGNALS — anti-fraud detections, reviewable by finance_admin
-- ============================================================================

CREATE TABLE IF NOT EXISTS fraud_signals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id       UUID REFERENCES wallets(id) ON DELETE SET NULL,
    signal_type     VARCHAR(50) NOT NULL,   -- 'velocity_deposit' | 'velocity_withdrawal' |
                                             -- 'deposit_withdraw_cycle' | 'multi_account_device' |
                                             -- 'high_risk_geo' | 'chargeback' | 'card_testing'
    severity        VARCHAR(10) NOT NULL,   -- 'low' | 'medium' | 'high' | 'critical'
    details         JSONB,
    reference_type  VARCHAR(30),            -- 'deposit' | 'withdrawal' | 'game'
    reference_id    UUID,
    status          VARCHAR(20) DEFAULT 'open' NOT NULL, -- 'open' | 'reviewed' | 'dismissed' | 'confirmed'
    reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_fraud_severity CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT chk_fraud_status CHECK (status IN ('open', 'reviewed', 'dismissed', 'confirmed'))
);

CREATE INDEX IF NOT EXISTS idx_fraud_signals_user_id ON fraud_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_fraud_signals_status ON fraud_signals(status);
CREATE INDEX IF NOT EXISTS idx_fraud_signals_created_at ON fraud_signals(created_at);

-- ============================================================================
-- ACCOUNTING RECONCILIATION LOGS — scheduled ledger-vs-cache drift checks
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounting_reconciliation_logs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id        UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    ledger_balance   NUMERIC(18,2) NOT NULL,  -- SUM(wallet_transactions) at check time
    cached_balance   NUMERIC(18,2) NOT NULL,  -- wallets.available_balance snapshot at check time
    drift_amount     NUMERIC(18,2) NOT NULL,  -- cached_balance - ledger_balance
    status           VARCHAR(20) DEFAULT 'ok' NOT NULL, -- 'ok' | 'drift_detected' | 'resolved'
    checked_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_reconciliation_status CHECK (status IN ('ok', 'drift_detected', 'resolved'))
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_wallet_id ON accounting_reconciliation_logs(wallet_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_status ON accounting_reconciliation_logs(status);

-- ============================================================================
-- REFUNDS — explicit approval trail, separate from the generic 'refund' txn type
-- ============================================================================

CREATE TABLE IF NOT EXISTS refunds (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_wallet_transaction_id  UUID NOT NULL REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
    user_id                         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount                          NUMERIC(18,2) NOT NULL,
    reason                          TEXT NOT NULL,
    status                          VARCHAR(20) DEFAULT 'pending' NOT NULL, -- 'pending' | 'approved' | 'rejected' | 'completed'
    approved_by                     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at                      TIMESTAMPTZ DEFAULT now() NOT NULL,
    processed_at                    TIMESTAMPTZ,
    CONSTRAINT chk_refund_status CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
    CONSTRAINT chk_refund_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_refunds_user_id ON refunds(user_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);

-- ============================================================================
-- END OF MIGRATION 0002
-- ============================================================================
