"""Turn streaming govulncheck JSON into an explicit pass/fail symbol inventory."""
import collections
import json
import re
from pathlib import Path
import sys

path = Path(sys.argv[1])
raw = path.read_text(encoding='utf-8')
decoder = json.JSONDecoder()
position = 0
messages = []
while position < len(raw):
    position = re.compile(r'\s*').match(raw, position).end()
    if position >= len(raw):
        break
    value, position = decoder.raw_decode(raw, position)
    messages.append(value)
configs = [message['config'] for message in messages if 'config' in message]
assert len(configs) == 1 and configs[0].get('scanner_name') == 'govulncheck', 'Missing scanner identity'
assert any('SBOM' in message for message in messages), 'Incomplete scan: missing scanned component inventory'
findings = [message['finding'] for message in messages if 'finding' in message]
symbols = [finding for finding in findings if any(frame.get('function') for frame in finding.get('trace', []))]
osv = {message['osv']['id']: message['osv'] for message in messages if 'osv' in message}
grouped = collections.defaultdict(list)
for finding in symbols:
    grouped[finding['osv']].append(finding)
summary = {'scannerConfig': configs[0], 'knownSymbolVulnerabilities': len(grouped), 'symbolFindings': len(symbols),
           'findings': [{'id': key, 'summary': osv[key].get('summary'),
                         'fixedVersions': sorted({finding.get('fixed_version', '') for finding in values}),
                         'modules': sorted({frame['module'] for finding in values for frame in finding['trace'] if 'module' in frame}),
                         'affectedSymbols': sorted({frame.get('package', '') + '.' + frame.get('function', '')
                                                    for finding in values for frame in finding['trace'] if frame.get('function')})}
                        for key, values in sorted(grouped.items())],
           'binaryScanLimitation': 'Symbol presence is not proof of remotely exploitable reachability; local replacements may lack version identity.'}
path.with_suffix('.summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
print(json.dumps({k: v for k, v in summary.items() if k != 'findings'}, indent=2))
for finding in summary['findings']:
    print(finding['id'], ','.join(finding['modules']), 'fixed:', ','.join(finding['fixedVersions']), finding['summary'])
raise SystemExit(1 if grouped else 0)
