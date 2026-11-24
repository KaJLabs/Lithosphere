import { describe, expect, it } from 'vitest';
import { Interface, keccak256 } from 'ethers';
import artifact from './fixtures/lithic-token.json';
import { parseLithicInterface, isLithicToken, nativeDeploymentCode } from '../lithic-interface.js';

describe('Lithic typed token discovery', () => {
  it('detects the full LEP-100 interface of compiler-produced bytecode', () => {
    const abi = parseLithicInterface(artifact.bytecode);
    expect(isLithicToken(abi)).toBe(true);
    expect(isLithicToken(abi.map(f => f.name === 'decimals' ? { ...f, outputs: [{ type: 'u256' }] } : f))).toBe(false);
    expect(isLithicToken(abi.filter(f => f.name !== 'transfer_from'))).toBe(false);
    expect(() => parseLithicInterface(artifact.bytecode.slice(0, -2))).toThrow();
  });
  it('accepts deployment bytecode only when its hash matches the gateway record', () => {
    const iface = new Interface(['function deploy(bytes,bytes32,bytes) returns (bytes)']);
    const input = iface.encodeFunctionData('deploy', [artifact.bytecode, '0x' + '00'.repeat(32), '0x']);
    expect(nativeDeploymentCode(input, keccak256(artifact.bytecode))).toBe(artifact.bytecode);
    expect(nativeDeploymentCode(input, '0x' + '00'.repeat(32))).toBeNull();
  });
});
