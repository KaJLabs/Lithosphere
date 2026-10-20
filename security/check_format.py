import json,subprocess
from pathlib import Path
r=Path(__file__).resolve().parents[1]
files=json.loads((r/'security/format-files.json').read_text())
bad=subprocess.check_output(['gofmt','-l',*[str(r/p) for p in files]],text=True)
assert not bad,'gofmt required: '+bad
print('Maintained Go file formatting: PASS')
