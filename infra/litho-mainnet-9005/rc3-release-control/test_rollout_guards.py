"""Meaningful refusal tests for common operational authorization mistakes."""
import copy,datetime as dt,json,tempfile,unittest
from pathlib import Path
import verify_rc3_activation as gate

ROOT=Path(__file__).resolve().parent
class Guards(unittest.TestCase):
 def setUp(self):
  self.profile=gate.read(ROOT/'RC3_TARGET_PROFILE.json')
  self.data=gate.read(ROOT/'RC3_ACTIVATION_APPROVAL.TEMPLATE.json')
  self.now=dt.datetime(2026,10,21,18,tzinfo=dt.timezone.utc)
  self.data.update(decision='approved',approvalId='TEST-ONLY',executionOperator='Operator',independentObserver='Observer',
    window={'startsAt':'2026-10-21T17:00:00Z','endsAt':'2026-10-21T19:00:00Z'},everestDecision='power-rebalancing')
 def test_complete_bindings_pass_without_authorizing_signature_or_activation(self):
  self.assertEqual(gate.check_bindings(self.data,self.profile,self.now).hour,17)
 def test_pending_template_denied(self):
  with self.assertRaises(ValueError):gate.check_bindings(gate.read(ROOT/'RC3_ACTIVATION_APPROVAL.TEMPLATE.json'),self.profile,self.now)
 def test_unsafe_bindings_denied(self):
  cases=[('same observer',lambda d:d.update(independentObserver=' operator ')),
   ('expired window',lambda d:d['window'].update(endsAt='2026-10-21T17:30:00Z')),
   ('modified binary',lambda d:d['identity'].update(binarySha256='0'*64)),
   ('wrong host',lambda d:d['targets'][0].update(host='192.0.2.1')),
   ('incomplete services',lambda d:d['targets'].pop()),
   ('no everest decision',lambda d:d.update(everestDecision=None)),
   ('unapproved pause',lambda d:d.update(everestDecision='announced-consensus-pause')),
   ('implicit pause',lambda d:d.update(consensusPauseApproved=True))]
  for name,change in cases:
   with self.subTest(name=name):
    item=copy.deepcopy(self.data);change(item)
    with self.assertRaises(ValueError):gate.check_bindings(item,self.profile,self.now)
 def test_r2_disposition_is_not_operational_acceptance(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory);doc=path/'R2.json';doc.write_bytes(json.dumps({'schemaVersion':1,'activationAuthorized':False,'independentApproval':None}).encode())
   self.data['authaOperationalAcceptance']={'artifactPath':doc.name,'artifactSha256':gate.sha(doc)}
   with self.assertRaisesRegex(ValueError,'not operational acceptance'):gate.check_acceptances(self.data,path,self.now)
 def test_modified_acceptance_denied(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory);doc=path/'acceptance.json';doc.write_text('{}',encoding='utf-8')
   self.data['authaOperationalAcceptance']={'artifactPath':doc.name,'artifactSha256':'0'*64}
   with self.assertRaisesRegex(ValueError,'hash differs'):gate.check_acceptances(self.data,path,self.now)
 def test_profile_and_signature_helper_pins_match(self):
  self.assertEqual(gate.sha(ROOT/'RC3_TARGET_PROFILE.json'),gate.PROFILE_SHA)
  self.assertEqual(gate.sha(ROOT/'release-controls/verify_l1_release_approval.py'),gate.LEGACY_SHA)

if __name__=='__main__':unittest.main(verbosity=2)
