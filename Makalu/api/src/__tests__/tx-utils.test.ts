import { describe, expect, it } from 'vitest';
import {
  isCosmosTxHash,
  isEvmTxHash,
  normalizeEvmTxHash,
  pickValidTxHash,
  sanitizeUpstreamMessage,
} from '../tx-utils.js';

describe('tx-utils', () => {
  it('accepts valid Cosmos transaction hashes', () => {
    expect(
      isCosmosTxHash('005689E58968B21A95D2D115B87482E7AD104D9B636AD38C1DAA9985C6A95E02'),
    ).toBe(true);
  });

  it('accepts valid EVM transaction hashes', () => {
    expect(
      isEvmTxHash('0xf3df3dce8dce77d8b1172dc9d191e11caed85563f5b5a323f6ea4a18ab97077f'),
    ).toBe(true);
  });

  it('normalizes bare and prefixed EVM transaction hashes to lowercase 0x form', () => {
    expect(
      normalizeEvmTxHash('f3df3dce8dce77d8b1172dc9d191e11caed85563f5b5a323f6ea4a18ab97077f'),
    ).toBe('0xf3df3dce8dce77d8b1172dc9d191e11caed85563f5b5a323f6ea4a18ab97077f');

    expect(
      normalizeEvmTxHash('0xF3DF3DCE8DCE77D8B1172DC9D191E11CAED85563F5B5A323F6EA4A18AB97077F'),
    ).toBe('0xf3df3dce8dce77d8b1172dc9d191e11caed85563f5b5a323f6ea4a18ab97077f');
  });

  it('prefers a valid primary hash and falls back to a valid secondary hash', () => {
    expect(
      pickValidTxHash(
        '005689E58968B21A95D2D115B87482E7AD104D9B636AD38C1DAA9985C6A95E02',
        '0xf3df3dce8dce77d8b1172dc9d191e11caed85563f5b5a323f6ea4a18ab97077f',
      ),
    ).toBe('005689E58968B21A95D2D115B87482E7AD104D9B636AD38C1DAA9985C6A95E02');

    expect(
      pickValidTxHash(
        'Missing or invalid parameters....',
        '0xf3df3dce8dce77d8b1172dc9d191e11caed85563f5b5a323f6ea4a18ab97077f',
      ),
    ).toBe('0xf3df3dce8dce77d8b1172dc9d191e11caed85563f5b5a323f6ea4a18ab97077f');
  });

  it('sanitizes low-level upstream RPC errors', () => {
    expect(
      sanitizeUpstreamMessage(
        'Missing or invalid parameters.',
        'Faucet request failed.',
      ),
    ).toBe('Faucet request failed.');

    expect(
      sanitizeUpstreamMessage(
        'Allowed amounts for LITHO: 1 LITHO, 2 LITHO, 5 LITHO',
        'Faucet request failed.',
      ),
    ).toBe('Allowed amounts for LITHO: 1 LITHO, 2 LITHO, 5 LITHO');
  });
});
