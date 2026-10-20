"""Fail closed on upstream release drift independently of advisory databases."""
import argparse,datetime,json,re,urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--ledger',type=Path,default=Path(__file__).with_name('upstream-release-ledger.json'));p.add_argument('--output',type=Path);a=p.parse_args()
ledger=json.loads(a.ledger.read_text());rows=[]
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'LITHO-maintenance/rc3'}),timeout=40) as r:return json.load(r)
def version(v):return tuple(map(int,re.findall(r'\d+',v)))
try:
    assert datetime.datetime.now(datetime.timezone.utc).date()<=datetime.date.fromisoformat(ledger['expires']),'Upstream release review expired'
    go=ledger['go']; releases=get('https://go.dev/dl/?mode=json&include=all')
    observed=max((r['version'] for r in releases if re.fullmatch(re.escape(go['branch'])+r'\d+',r['version']) and r['stable']),key=version)
    rows.append({'component':'Go','observedLatest':observed,'reviewedLatest':go['reviewedLatest'],'passed':version(observed)<=version(go['reviewedLatest'])})
    for module in ledger['modules']:
        url='https://api.github.com/repos/'+module['repo']+'/git/matching-refs/tags/'+module['prefix']
        tags=get(url);versions=[t['ref'].removeprefix('refs/tags/') for t in tags]
        observed=max((v for v in versions if re.fullmatch(re.escape(module['prefix'])+r'\d+(?:\.\d+)*',v)),key=version)
        rows.append({'component':module['repo'],'source':url,'observedLatest':observed,'reviewedLatest':module['reviewedLatest'],'passed':version(observed)<=version(module['reviewedLatest'])})
    passed=all(r['passed'] for r in rows);error=None
except Exception as e:passed=False;error=str(e)
record={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'passed':passed,'error':error,'rows':rows,'scope':'Fresh release-feed review gate, independent of OSV. Decisions remain in the ledger.'}
if a.output:a.output.write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2));raise SystemExit(0 if passed else 1)
