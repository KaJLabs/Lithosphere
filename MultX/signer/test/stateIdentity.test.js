import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initializeJournal, loadStateIdentity } from '../src/stateIdentity.js';
import { createDecisionJournal } from '../src/journal.js';

const identity = {schemaVersion:1,signerAddress:'0x'+'11'.repeat(20),deploymentPlanSha256:'aa'.repeat(32),
  activationEpoch:1,generation:'bb'.repeat(16)};
const decision = '9005:0x'+'22'.repeat(20)+':1';
const hash = '0x'+'33'.repeat(32);
function fixture(fn) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'multx-identity-'));
  fs.chmodSync(root,0o700);
  try { fn(root,path.join(root,'journal.jsonl')); } finally { fs.rmSync(root,{recursive:true,force:true}); }
}
const linux = {skip:process.platform==='win32'};

test('production requires the external identity file with a specific diagnostic', () => {
  assert.throws(() => loadStateIdentity(undefined, identity.signerAddress), /SIGNER_STATE_IDENTITY_FILE is required in production/);
});

test('on-load equivocation is rejected before a restored journal can be used', linux, () => fixture((_root, file) => {
  initializeJournal(file, identity);
  const record = value => JSON.stringify({ key: decision, hash: value }) + '\n';
  fs.appendFileSync(file, record(hash) + record(hash));
  createDecisionJournal(file, { strictPermissions: true, expectedIdentity: identity });
  fs.appendFileSync(file, record('0x' + '44'.repeat(32)));
  assert.throws(() => createDecisionJournal(file, { strictPermissions: true, expectedIdentity: identity }), /equivocation detected in state/);
}));

test('a journal symlink is explicitly rejected before opening its valid target', linux, () => fixture((root, file) => {
  initializeJournal(file, identity);
  const linked = path.join(root, 'linked.jsonl');
  fs.symlinkSync(file, linked);
  assert.throws(() => createDecisionJournal(linked, { strictPermissions: true, expectedIdentity: identity }), /signing journal must be a regular file, not a symlink/);
}));
test('production refuses absent journal and absent externally approved identity',linux,()=>fixture((_root,file)=>{
  assert.throws(()=>createDecisionJournal(file,{strictPermissions:true,expectedIdentity:identity}),/missing/);
  initializeJournal(file,identity);
  assert.throws(()=>createDecisionJournal(file,{strictPermissions:true}),/missing/);
}));
test('first-use ceremony is exclusive and restart retains recent decisions',linux,()=>fixture((_root,file)=>{
  initializeJournal(file,identity);
  assert.throws(()=>initializeJournal(file,identity),/exist/i);
  const journal=createDecisionJournal(file,{strictPermissions:true,expectedIdentity:identity});
  journal.record(decision,hash);
  const restored=createDecisionJournal(file,{strictPermissions:true,expectedIdentity:identity});
  assert.equal(restored.record(decision,hash),false);
  assert.throws(()=>restored.record(decision,'0x'+'44'.repeat(32)),/equivocation/);
}));
test('missing, empty and identity-only mismatched restore fails closed',linux,()=>fixture((_root,file)=>{
  initializeJournal(file,identity);
  createDecisionJournal(file,{strictPermissions:true,expectedIdentity:identity}).record(decision,hash);
  fs.unlinkSync(file);
  assert.throws(()=>createDecisionJournal(file,{strictPermissions:true,expectedIdentity:identity}),/missing/);
  fs.writeFileSync(file,'',{mode:0o600});
  assert.throws(()=>createDecisionJournal(file,{strictPermissions:true,expectedIdentity:identity}),/incomplete/);
  fs.writeFileSync(file,JSON.stringify({stateIdentity:{...identity,generation:'cc'.repeat(16)}})+'\n');
  assert.throws(()=>createDecisionJournal(file,{strictPermissions:true,expectedIdentity:identity}),/identity mismatch/);
}));
test('wrong signer, epoch and deployment root do not reuse a journal',linux,()=>fixture((_root,file)=>{
  initializeJournal(file,identity);
  for(const changed of [{signerAddress:'0x'+'55'.repeat(20)},{activationEpoch:2},{deploymentPlanSha256:'dd'.repeat(32)}]) {
    assert.throws(()=>createDecisionJournal(file,{strictPermissions:true,expectedIdentity:{...identity,...changed}}),/identity mismatch/);
  }
}));
test('deletion and truncation while running refuse append and cached decision reuse',linux,()=>fixture((_root,file)=>{
  initializeJournal(file,identity);
  const journal=createDecisionJournal(file,{strictPermissions:true,expectedIdentity:identity});
  journal.record(decision,hash);
  fs.truncateSync(file,0);
  assert.throws(()=>journal.record(decision,hash),/truncated/);
  fs.unlinkSync(file);
  assert.throws(()=>journal.record(decision,hash),/ENOENT/);
  assert.equal(fs.existsSync(file),false);
}));
test('identity file is bound to public signer and rejects symlink or permissive mode',linux,()=>fixture((root,_file)=>{
  const id=path.join(root,'approved.json');
  fs.writeFileSync(id,JSON.stringify(identity),{mode:0o600});
  assert.deepEqual(loadStateIdentity(id,identity.signerAddress),identity);
  assert.throws(()=>loadStateIdentity(id,'0x'+'66'.repeat(20)),/signer mismatch/);
  fs.chmodSync(id,0o644);
  assert.throws(()=>loadStateIdentity(id,identity.signerAddress),/owner-only/);
  fs.chmodSync(id,0o600);
  fs.symlinkSync(id,path.join(root,'linked.json'));
  assert.throws(()=>loadStateIdentity(path.join(root,'linked.json'),identity.signerAddress));
}));
test('production rejects old headerless journals and partial trailing writes',linux,()=>fixture((_root,file)=>{
  fs.writeFileSync(file,JSON.stringify({key:decision,hash})+'\n',{mode:0o600});
  assert.throws(()=>createDecisionJournal(file,{strictPermissions:true,expectedIdentity:identity}),/identity/);
  fs.unlinkSync(file); initializeJournal(file,identity);
  fs.appendFileSync(file,'{"key":');
  assert.throws(()=>createDecisionJournal(file,{strictPermissions:true,expectedIdentity:identity}),/incomplete/);
}));
