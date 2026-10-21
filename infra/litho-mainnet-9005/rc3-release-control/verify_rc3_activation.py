"""Offline approval gate for the exact accepted rc3 and seven-service profile.

This never activates a binary. Deployment additionally needs the protected
workflow receipt and fresh on-host/dual-origin preflights in ROLLOUT_PLAN.txt.
"""
import argparse, datetime as dt, hashlib, importlib.util, json, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parent
PROFILE_SHA='6559e88c0234ecd9ccb2b600a4119df633ecdbeadc78b79a69c7abaf53fe4977'
LEGACY_SHA='5ec1e313cb09d10dcea57260cd1f68c99271de17553a2cce2adf45b0fc59dbc6'
BOUND=('identity','targets','operationType','window','executionOperator','independentObserver',
       'everestDecision','consensusPauseApproved','rollbackPlan')

def sha(path):
    with Path(path).open('rb') as handle:return hashlib.file_digest(handle,'sha256').hexdigest()

def read(path):return json.loads(Path(path).read_text(encoding='utf-8'))

def text(value,label):
    if not isinstance(value,str) or value.strip().casefold() in {'','pending','tbd','todo','none','unknown'}:
        raise ValueError(label+' is missing')
    return value.strip()

def timestamp(value,label):
    try:parsed=dt.datetime.fromisoformat(text(value,label).replace('Z','+00:00'))
    except (TypeError,ValueError) as exc:raise ValueError(label+' must be an ISO timestamp') from exc
    if parsed.utcoffset() is None:raise ValueError(label+' needs timezone')
    return parsed.astimezone(dt.timezone.utc)

def artifact(directory,name):
    path=(directory/text(name,'artifactPath')).resolve(strict=True)
    if path.parent!=directory.resolve() or not path.is_file():raise ValueError('Artifact escapes approval directory')
    return path

def check_bindings(data,profile,now):
    if data.get('schemaVersion')!=3 or data.get('decision')!='approved':raise ValueError('Release decision is not approved')
    text(data.get('approvalId'),'approvalId')
    if data.get('profileId')!=profile['profileId']:raise ValueError('Wrong rc3 profile')
    for key in ('identity','targets'):
        if data.get(key)!=profile[key]:raise ValueError('Exact reviewed '+key+' differs')
    if data.get('operationType')!='serialized-binary-replacement':raise ValueError('Wrong operation type')
    window=data.get('window')
    if not isinstance(window,dict):raise ValueError('Missing window')
    start=timestamp(window.get('startsAt'),'window.startsAt');end=timestamp(window.get('endsAt'),'window.endsAt')
    if not start<=now<=end or start>=end:raise ValueError('Outside approved window')
    operator=text(data.get('executionOperator'),'executionOperator')
    observer=text(data.get('independentObserver'),'independentObserver')
    if operator.casefold()==observer.casefold():raise ValueError('Operator and observer must differ')
    decision=data.get('everestDecision')
    if decision not in {'power-rebalancing','announced-consensus-pause'}:raise ValueError('Explicit Everest operating decision required')
    if type(data.get('consensusPauseApproved')) is not bool:raise ValueError('Pause approval must be boolean')
    if decision=='announced-consensus-pause' and data['consensusPauseApproved'] is not True:raise ValueError('Pause not approved')
    if decision=='power-rebalancing' and data['consensusPauseApproved'] is not False:raise ValueError('Rebalancing scope must not authorize a pause')
    text(data.get('rollbackPlan'),'rollbackPlan')
    return start

def check_acceptances(data,directory,start):
    for party in ('autha','kaj'):
        key=party+'OperationalAcceptance';entry=data.get(key)
        if not isinstance(entry,dict):raise ValueError(key+' missing')
        document=artifact(directory,entry.get('artifactPath'))
        if sha(document)!=entry.get('artifactSha256'):raise ValueError(key+' hash differs')
        acceptance=read(document)
        if acceptance.get('schemaVersion')!=1 or acceptance.get('approvalType')!=party+'-rc3-operations' or acceptance.get('decision')!='approved':
            raise ValueError(key+' is not operational acceptance')
        text(acceptance.get('approvalReference'),key+'.approvalReference')
        if timestamp(acceptance.get('approvedAt'),key+'.approvedAt')>start:raise ValueError('Acceptance must predate window')
        for field in BOUND:
            if acceptance.get(field)!=data.get(field):raise ValueError(key+'.'+field+' differs')

def verify(approval,binary,rollback,source,sbom,rollback_source):
    profile_path=ROOT/'RC3_TARGET_PROFILE.json'
    if sha(profile_path)!=PROFILE_SHA:raise ValueError('Pinned profile changed')
    profile=read(profile_path);data=read(approval);now=dt.datetime.now(dt.timezone.utc)
    start=check_bindings(data,profile,now)
    for path,key in [(binary,'binarySha256'),(rollback,'rollbackBinarySha256'),(source,'sourceArchiveSha256'),
                     (sbom,'sbomSha256'),(rollback_source,'rollbackSourceArchiveSha256')]:
        if sha(path)!=profile['identity'][key]:raise ValueError(key+' differs')
    check_acceptances(data,approval.parent,start)
    verifier=ROOT/'release-controls/verify_l1_release_approval.py'
    if sha(verifier)!=LEGACY_SHA:raise ValueError('Pinned signature verifier changed')
    spec=importlib.util.spec_from_file_location('signature_gate',verifier)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    signature=artifact(approval.parent,data.get('bundleSignaturePath'))
    module.verify_detached_signature(approval.resolve(),signature,ROOT/'release-controls/KaJ-Labs-Release-Signing-PublicKey.asc')
    return {'offlineApprovalGate':'PASS','profileId':profile['profileId'],'releaseId':profile['identity']['releaseId'],
            'approvalSha256':sha(approval),'verifiedAt':now.isoformat(),
            'activationAuthorizedByThisProgram':False,
            'remaining':'Protected workflow receipt, matching live executable/configuration, fresh two-origin quorum/IBC checks, and independent observer are required before mutation.'}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('approval','binary','rollback','source','sbom','rollback-source'):parser.add_argument('--'+name,required=True,type=Path)
    args=parser.parse_args()
    try:result=verify(args.approval,args.binary,args.rollback,args.source,args.sbom,args.rollback_source)
    except (ValueError,OSError,KeyError,TypeError) as exc:
        print(json.dumps({'offlineApprovalGate':'DENIED','reason':str(exc),'activationAuthorized':False}));return 1
    print(json.dumps(result));return 0

if __name__=='__main__':sys.exit(main())
