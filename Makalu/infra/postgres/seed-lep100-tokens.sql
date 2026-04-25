-- ============================================================================
-- Seed 10 LEP100 Tokens into Lithosphere Explorer
-- Run this after init.sql to populate token list
-- ============================================================================

INSERT INTO contracts (address, name, symbol, decimals, total_supply, contract_type)
VALUES
  ('0x599a7E135f1790ae117b4EdDc0422D24Bc766161', 'Wrapped Lithosphere', 'wLITHO', 18, '1000000000000000000000000000', 'token'),
  ('0xC4645CA5411D6E27556780AB4cdd0DF7e609df74', 'Lithosphere LitBTC', 'LitBTC', 18, '21000000000000000000000000', 'token'),
  ('0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d', 'Lithosphere Algo', 'LAX', 18, '10000000000000000000000000000', 'token'),
  ('0xEF2f35f6d0fb7DC9E87b8ca8252AE2E6ffb2a25e', 'Jot Art', 'JOT', 18, '1000000000000000000000000000', 'token'),
  ('0x10D4BB600c96e9243E2f50baFED8b2478F25af61', 'Colle AI', 'COLLE', 18, '5000000000000000000000000000', 'token'),
  ('0xAcD98E323968647936887aD4934e64B01060727e', 'Imagen Network', 'IMAGE', 18, '10000000000000000000000000000', 'token'),
  ('0x10052B8ccD2160b8F9880C6b4F5DD117fF253B1c', 'AGII', 'AGII', 18, '1000000000000000000000000000', 'token'),
  ('0x798eD6bFc5bfCFc60938d5098825b354427A0786', 'Built AI', 'BLDR', 18, '1000000000000000000000000000', 'token'),
  ('0x151ef362eA96853702Cc5e7728107e3961fbD22e', 'FurGPT', 'FGPT', 18, '1000000000000000000000000000', 'token'),
  ('0xDB829befCF8E582379E2c034FA2589b8D2EA1c5D', 'Mansa AI', 'MUSA', 18, '1000000000000000000000000000', 'token')
ON CONFLICT (address) DO NOTHING;

-- Verify insertion
SELECT COUNT(*) as token_count FROM contracts WHERE contract_type = 'token' AND symbol IN ('wLITHO', 'LitBTC', 'LAX', 'JOT', 'COLLE', 'IMAGE', 'AGII', 'BLDR', 'FGPT', 'MUSA');
