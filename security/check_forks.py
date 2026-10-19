"""Fail on new fork-ancestry advisories, expired review or changed exposure.

Known matches remain in the ledger with source evidence; this check does not
alter module versions, vulnerability data or attest to an independent audit.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ledger = json.loads((ROOT / 'security/fork-ledger.json').read_text())
assert datetime.datetime.now(datetime.timezone.utc).date() <= datetime.date.fromisoformat(ledger['reviewExpires']), 'Fork triage review has expired'
for relative, expected in ledger['sourceGuards'].items():
    assert hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() == expected, 'Re-review changed fork source: ' + relative
env = {**os.environ, 'GOTOOLCHAIN':'local', 'GOWORK':'off'}
packages = set(subprocess.check_output(['go', 'list', '-mod=readonly', '-tags=netgo,ledger', '-deps', './cmd/evmosd'],
    cwd=ROOT / 'node', env=env, text=True).splitlines())
for forbidden in ledger['forbiddenRuntimePackages']:
    assert not any(p == forbidden or p.startswith(forbidden + '/') for p in packages), 'Re-review newly enabled package: ' + forbidden
for forbidden in ledger.get('forbiddenExactRuntimePackages', []):
    assert forbidden not in packages, 'Re-review newly enabled service: ' + forbidden
for item in ledger['queries']:
    request = urllib.request.Request('https://api.osv.dev/v1/query',
        json.dumps({'package':{'ecosystem':'Go','name':item['module']},'version':item['version']}).encode(),
        {'Content-Type':'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        observed = {v['id'] for v in json.load(response).get('vulns', [])}
    unknown = observed - set(item['reviewedMatches'])
    assert not unknown, 'Unreviewed advisories for ' + item['module'] + ': ' + ','.join(sorted(unknown))
    print(item['module'], item['version'], 'version matches retained for review:', ','.join(sorted(observed)))
print('Fork identity, exposure and review-expiry checks passed. This is a bounded advisory check, not a security certification.')
