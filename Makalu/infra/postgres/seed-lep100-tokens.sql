-- ============================================================================
-- Seed 9 LEP100 Tokens into Lithosphere Explorer
-- Run this after init.sql to populate token list
-- ============================================================================

INSERT INTO contracts (address, name, symbol, decimals, total_supply, contract_type)
VALUES
  ('0x93d74580a7b63a5B1FE5Aae05b7470bf9317aF9A', 'Wrapped Lithosphere', 'wLITHO', 18, '1000000000000000000000000000', 'token'),
  ('0x0292C22AFC5DF714d51273BF16F9Fc3f17d97e7E', 'Lithosphere Algo', 'LAX', 6, '10000000000000', 'token'),
  ('0xC0725568E86DCF6abE5729903bDF6FF999Ad52BD', 'Jot Art', 'JOT', 18, '1000000000000000000000000000', 'token'),
  ('0x25F70D427EB96b784ff2d0B458B6Aa5f6D251346', 'Colle AI', 'COLLE', 18, '5000000000000000000000000000', 'token'),
  ('0xdB7b1F4b735e9f8096a44657599c9F6882ba0B0D', 'Imagen Network', 'IMAGE', 18, '10000000000000000000000000000', 'token'),
  ('0xDB04AD818614a329110bdDA30c7c5e8C1Be61e45', 'AGII', 'AGII', 18, '1000000000000000000000000000', 'token'),
  ('0xb47B81370934Db2461759BD29796100fdD35e3E9', 'Built AI', 'BLDR', 18, '1000000000000000000000000000', 'token'),
  ('0x71ce67fCf5D130473F46DBaD05f3260A8390dE73', 'FurGPT', 'FGPT', 18, '1000000000000000000000000000', 'token'),
  ('0x72791d72B6097D487cEC58605A62396c50C08b69', 'Mansa AI', 'MUSA', 18, '1000000000000000000000000000', 'token')
ON CONFLICT (address) DO NOTHING;

-- Verify insertion
SELECT COUNT(*) as token_count FROM contracts WHERE contract_type = 'token' AND symbol IN ('wLITHO', 'LAX', 'JOT', 'COLLE', 'IMAGE', 'AGII', 'BLDR', 'FGPT', 'MUSA');
