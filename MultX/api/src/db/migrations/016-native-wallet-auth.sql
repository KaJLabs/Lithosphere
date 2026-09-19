CREATE TABLE native_wallet_auth_nonces (
 audience TEXT NOT NULL,
 wallet TEXT NOT NULL,
 nonce TEXT NOT NULL,
 used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(audience,wallet,nonce)
);

CREATE INDEX native_wallet_auth_nonces_used_at_idx
  ON native_wallet_auth_nonces(used_at);
