import { Interface, getBytes, keccak256, toUtf8String } from 'ethers';

const TYPES = ['', 'u64', 'u256', 'bool', 'address', 'bytes32', 'string'];
export interface LithicAbi { type: 'function' | 'event'; name: string; inputs: { name?: string; type: string }[]; outputs?: { type: string }[] }

const deployment = new Interface(['function deploy(bytes code, bytes32 initializer, bytes args) returns (bytes)']);

export function nativeDeploymentCode(input: string, expectedHash: string): string | null {
  try {
    const decoded = deployment.parseTransaction({ data: input });
    if (decoded?.name !== 'deploy') return null;
    const code = String(decoded.args[0]);
    return keccak256(code).toLowerCase() === expectedHash.toLowerCase() ? code : null;
  } catch { return null; }
}

class Reader {
  position = 0;
  constructor(readonly bytes: Uint8Array) {}
  take(n: number): Uint8Array {
    if (n < 0 || this.position + n > this.bytes.length) throw new Error('Truncated Lithic data');
    const value = this.bytes.slice(this.position, this.position + n); this.position += n; return value;
  }
  byte() { return this.take(1)[0]; }
  u16() { const b = this.take(2); return b[0] * 256 + b[1]; }
  count(max: number) { const n = this.u16(); if (n > max) throw new Error('Lithic count exceeds limit'); return n; }
  type() { const t = TYPES[this.byte()]; if (!t) throw new Error('Unknown Lithic type'); return t; }
  name() { const n = this.count(255); if (!n) throw new Error('Empty Lithic name'); return toUtf8String(this.take(n)); }
  end() { if (this.position !== this.bytes.length) throw new Error('Trailing Lithic data'); }
}

/** Parse the typed interface while skipping function bodies using the pinned
 * lithovm-bytecode v1–v14 wire format. Unknown versions/opcodes fail closed.
 * Reference: KaJLabs/Lithosphere 8725ce9, packages/vm/bytecode/src/lib.rs. */
export function parseLithicInterface(code: string): LithicAbi[] {
  const r = new Reader(getBytes(code));
  if (toUtf8String(r.take(7)) !== 'LITHOVM') throw new Error('Invalid LithoVM magic');
  const version = r.byte(); if (version < 1 || version > 14) throw new Error('Unsupported LithoVM version');
  const expression = () => {
    const count = r.count(4096);
    for (let i = 0; i < count; i++) {
      const op = r.byte();
      if (op === 1) { r.type(); r.take(32); }
      else if ([2, 9, 10, 16].includes(op)) r.take(2);
      else if (op < 3 || op > 19) throw new Error('Unknown LithoVM instruction');
    }
  };
  const statements = (depth = 0) => {
    if (depth > 64) throw new Error('LithoVM nesting limit');
    const count = r.count(4096);
    for (let i = 0; i < count; i++) {
      const op = r.byte();
      switch (op) {
        case 1: case 8: r.type(); expression(); break;
        case 2: case 11: expression(); break;
        case 3: expression(); statements(depth + 1); statements(depth + 1); break;
        case 4: case 9: r.take(2); expression(); break;
        case 5: case 13: {
          r.take(2); const n = r.count(64); for (let j = 0; j < n; j++) expression();
          if (op === 13) expression(); break;
        }
        case 6: expression(); expression(); break;
        case 7: expression(); expression(); expression(); break;
        case 10: expression(); statements(depth + 1); break;
        case 12: break;
        case 14: case 15: {
          if (op === 14) r.type(); else expression();
          expression(); expression(); expression();
          const n = r.count(64); for (let j = 0; j < n; j++) { r.type(); expression(); } break;
        }
        default: throw new Error('Unknown LithoVM statement');
      }
    }
  };
  if (version >= 3) { const n = r.count(256); for (let i = 0; i < n; i++) { r.name(); r.type(); } }
  if (version >= 11) { const n = r.count(256); for (let i = 0; i < n; i++) { r.name(); const keys = r.count(64); for (let j = 0; j < keys; j++) r.type(); r.type(); } }
  const abi: LithicAbi[] = [];
  if (version >= 5) {
    const n = r.count(256);
    for (let i = 0; i < n; i++) {
      const name = r.name(); const count = r.count(64); const inputs = [];
      for (let j = 0; j < count; j++) inputs.push({ name: r.name(), type: r.type() });
      abi.push({ type: 'event', name, inputs });
    }
  }
  const count = r.count(1024);
  for (let i = 0; i < count; i++) {
    const name = r.name(); const n = r.count(64); const inputs = [];
    for (let j = 0; j < n; j++) inputs.push({ type: r.type() });
    abi.push({ type: 'function', name, inputs, outputs: [{ type: r.type() }] });
    const op = r.byte();
    if (op === 1) r.take(32); else if (op === 2) r.take(2); else if (op === 3) expression();
    else if (op === 4) statements(); else throw new Error('Unknown LithoVM return');
  }
  r.end(); return abi;
}

export function isLithicToken(abi: LithicAbi[]): boolean {
  const required: [string, string[], string][] = [
    ['name', [], 'string'], ['symbol', [], 'string'], ['decimals', [], 'u64'], ['total_supply', [], 'u256'],
    ['balance_of', ['address'], 'u256'], ['transfer', ['address', 'u256'], 'bool'],
    ['approve', ['address', 'u256'], 'bool'], ['allowance', ['address', 'address'], 'u256'],
    ['transfer_from', ['address', 'address', 'u256'], 'bool'],
  ];
  return required.every(([name, inputs, output]) => abi.some(f => f.type === 'function' && f.name === name
    && f.inputs.map(i => i.type).join() === inputs.join() && f.outputs?.length === 1 && f.outputs[0].type === output))
    && ['Transfer', 'Approval'].every(name => abi.some(f => f.type === 'event' && f.name === name && f.inputs.map(i => i.type).join() === 'address,address,u256'));
}
