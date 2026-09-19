#!/usr/bin/env python3
"""Package reviewed source paths and evidence, excluding live secrets/generated trees."""
import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
import subprocess
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--evidence', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
evidence = Path(args.evidence).resolve()
output = Path(args.output).resolve()
blocked_parts = {'.git','node_modules','dist','artifacts','cache','test-results','playwright-report','.venv','__pycache__'}

def allowed(name):
    parts = PurePosixPath(name).parts
    if not parts or any(part in blocked_parts for part in parts):
        return False
    basename = parts[-1]
    if basename.startswith('.env') and basename not in {'.env.example','.env.sample','.env.template'}:
        return False
    if basename.endswith(('.pem','.key','.p12','.pfx','.log')):
        return False
    return name.startswith('MultX/') or (name.startswith('Makalu/contracts/src/dex/') and name.endswith('.sol'))

if subprocess.run(['git', 'diff-index', '--quiet', 'HEAD', '--'], cwd=root).returncode:
    raise SystemExit('Refusing candidate packaging from a checkout with tracked changes')
untracked = subprocess.check_output(
    ['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=root
).decode().split('\0')
eligible_untracked = sorted(name for name in untracked if allowed(name))
if eligible_untracked:
    raise SystemExit('Refusing eligible untracked source: ' + eligible_untracked[0])

tree = subprocess.check_output(['git', 'ls-tree', '-r', '-z', 'HEAD'], cwd=root).split(b'\0')
blobs = {}
for raw in tree:
    if not raw:
        continue
    metadata, encoded_name = raw.split(b'\t', 1)
    mode, kind, oid = metadata.decode().split(' ')
    name = encoded_name.decode()
    if allowed(name):
        if mode == '120000' or kind != 'blob':
            raise SystemExit('Refusing non-regular source: ' + name)
        blobs[name] = oid

inventory = []
for name, oid in sorted(blobs.items()):
    data = subprocess.check_output(['git', 'cat-file', 'blob', oid], cwd=root)
    if re.search(rb'-----BEGIN (?:EC |RSA )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/]{32,}',data):
        raise SystemExit('Refusing embedded private key: ' + name)
    inventory.append({'path':name,'blob':oid,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
if not inventory:
    raise SystemExit('Source inventory is empty')
identity = {'kind':'git-commit-source-snapshot','baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip(),
            'files':inventory}
(evidence / 'SOURCE_MANIFEST.json').write_text(json.dumps(identity, indent=2) + '\n')
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for entry in inventory:
        data=subprocess.check_output(['git','cat-file','blob',entry['blob']],cwd=root)
        if hashlib.sha256(data).hexdigest()!=entry['sha256']:
            raise SystemExit('Source changed while packaging: ' + entry['path'])
        archive.writestr(entry['path'],data)
    for path in sorted(evidence.iterdir()):
        if path.is_file() and path.suffix in {'.md','.json','.log'} and not path.name.startswith('local-node-'):
            archive.write(path, 'evidence/' + path.name)
digest=hashlib.sha256(output.read_bytes()).hexdigest()
with zipfile.ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise SystemExit('Archive CRC verification failed')
    for entry in inventory:
        if hashlib.sha256(archive.read(entry['path'])).hexdigest()!=entry['sha256']:
            raise SystemExit('Archive hash mismatch: '+entry['path'])
(evidence / 'ARCHIVE_SHA256.txt').write_text(digest + '  ' + output.name + '\n')
print(json.dumps({'archive':str(output),'sha256':digest,'sourceFiles':len(inventory),'bytes':output.stat().st_size}))
