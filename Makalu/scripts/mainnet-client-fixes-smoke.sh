#!/usr/bin/env bash
set -euo pipefail
python3 - "${BASE_URL:?Set BASE_URL}" <<'PY'
import json, sys, urllib.request
base = sys.argv[1].rstrip('/')
def get(path):
    with urllib.request.urlopen(base + path, timeout=25) as response:
        return json.load(response)
validators = get('/api/validators?metrics=1&sort=tokens')
assert validators, 'No validators returned'
stake = [int(v['tokens']) for v in validators]
assert stake == sorted(stake, reverse=True), 'Voting power is not descending numerically'
commission = get('/api/validators?metrics=1&sort=commission')
from decimal import Decimal
rates = [Decimal(v['commission'].rstrip('%')) for v in commission]
assert rates == sorted(rates), 'Commission is not ascending numerically'
tx = get('/api/txs/85D2021E9996402CB31F04B6953753F91B8BDC28AF3B6C25168E7FFEE1F1C378')
assert tx.get('memo') == '123456', 'Signed transaction memo was not recovered'
assert tx.get('value') == '10000000000000000', 'Transaction value changed'
summary = get('/api/market-summary')
assert int(summary['totalSupply']) > 0, 'Native supply unavailable'
assert int(summary['bondedTokens']) > 0, 'Bonded voting power unavailable'
market = summary.get('market')
assert market is not None, 'Mainnet market adapter is disabled'
assert market['price'] is None or Decimal(market['price']) > 0, 'Invalid price'
assert market['source'] == 'Ignite DEX' and market['kind'] in ('launch price', 'last trade'), 'Ignite price missing'
assert Decimal(market['price']) > 0, 'Ignite price invalid'
quantt_status = get('/api/quantt/status')
assert quantt_status['configured'] and quantt_status['apiOrigin'] == 'https://api.quantts.ai', 'QUANTTS is not configured'
snapshot = get('/api/quantt/insights?symbol=BTC')
assert snapshot['data']['symbol'] == 'BTC' and snapshot['data']['price'] > 0, 'QUANTTS snapshot invalid'
assert 'qk_partner_' not in json.dumps(snapshot), 'Credential exposed in snapshot'
print('Provider integrations passed: Ignite quote and authenticated QUANTTS BTC snapshot')
print('Client fixes passed: numeric stake/commission sorting, signed memo, original value, native supply, bonded power, market adapter')
PY
