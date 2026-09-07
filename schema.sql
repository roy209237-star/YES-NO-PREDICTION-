CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20) UNIQUE,
  otp_hash TEXT,
  otp_expires_at TIMESTAMPTZ,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  points BIGINT NOT NULL DEFAULT 10000 CHECK (points >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS markets (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(240) NOT NULL,
  description TEXT DEFAULT '',
  closes_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  result VARCHAR(3),
  yes_count BIGINT NOT NULL DEFAULT 0,
  no_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (result IS NULL OR result IN ('YES','NO')),
  CHECK (status IN ('open','closed','resolved'))
);

CREATE TABLE IF NOT EXISTS predictions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id BIGINT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  side VARCHAR(3) NOT NULL CHECK (side IN ('YES','NO')),
  stake BIGINT NOT NULL CHECK (stake > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reward BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  UNIQUE(user_id, market_id),
  CHECK (status IN ('pending','won','lost','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_markets_status_close ON markets(status, closes_at);
CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_market ON predictions(market_id);

CREATE TABLE IF NOT EXISTS point_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prediction_id BIGINT REFERENCES predictions(id) ON DELETE SET NULL,
  amount BIGINT NOT NULL,
  type VARCHAR(30) NOT NULL,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_user ON point_ledger(user_id, created_at DESC);
