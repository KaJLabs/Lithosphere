import test from 'node:test';
import assert from 'node:assert/strict';
import { requireNativeBridgeBinding } from '../src/services/nativeBridgeBinding.js';

test('native settlement cannot redirect bridge holder or convert the locked amount', () => {
  const user='0x0000000000000000000000000000000000000090';
  const lock={user,amount:'2000'};
  assert.doesNotThrow(()=>requireNativeBridgeBinding(lock,{holder:user,amount:'2000'}));
  assert.throws(()=>requireNativeBridgeBinding(lock,{holder:user,amount:'1500'}),/preserve source lock/);
  assert.throws(()=>requireNativeBridgeBinding(lock,{holder:'0x0000000000000000000000000000000000000050',amount:'2000'}),/preserve source lock/);
});
