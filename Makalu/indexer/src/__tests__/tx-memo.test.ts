import { describe, expect, it } from 'vitest';
import { decodeTxMemo } from '../tx-memo.js';
describe('TxRaw memo decoding', () => {
  it('decodes the original mainnet transaction bytes', () => {
    const raw = 'CqQBCpkBChwvY29zbW9zLmJhbmsudjFiZXRhMS5Nc2dTZW5kEnkKLGxpdGhvMTI2MHE0ZWFmNHo2bDh2YzN2ZzM2eHgyY2VobXlwdHhkeGtzbWNrEixsaXRobzFwczg0cTllNDBka3V0ZHdxbDJ5bWo4ZnJzNzdzcmZsM25jdHRxaxobCgZ1bGl0aG8SETEwMDAwMDAwMDAwMDAwMDAwEgYxMjM0NTYSdApZCk8KKC9ldGhlcm1pbnQuY3J5cHRvLnYxLmV0aHNlY3AyNTZrMS5QdWJLZXkSIwohA5b/eSX+C2yZJeJJiNuNNwWYduT/lWNs/HCvOXY5JIpWEgQKAggBGAESFwoRCgZ1bGl0aG8SBzE1MDAwMDAQ8JMJGkBBXJ+mwagl9I14MLUV9DJdjakNrKhRPCOa2zg9NewnVS+5AbA1+SmXD6n85LzxzKfNepMpxRywHik8GRt16a9I';
    expect(decodeTxMemo(Buffer.from(raw, 'base64'))).toBe('123456');
  });
  it('preserves Unicode, newlines and whitespace', () => {
    const memo = '  exchange\nمذكرة  ';
    const bytes = Buffer.from(memo);
    expect(decodeTxMemo(Buffer.concat([Buffer.from([10, bytes.length + 2, 18, bytes.length]), bytes]))).toBe(memo);
  });
  it('handles omitted and empty memos', () => {
    expect(decodeTxMemo(Buffer.from([10, 0]))).toBe('');
    expect(decodeTxMemo(Buffer.from([10, 2, 18, 0]))).toBe('');
  });
  it('uses the final singular memo field, matching protobuf semantics', () => {
    expect(decodeTxMemo(Buffer.from([10, 6, 18, 1, 65, 18, 1, 66]))).toBe('B');
  });
  it('rejects truncated data instead of silently indexing an empty memo', () => {
    expect(() => decodeTxMemo(Buffer.from([10, 5, 18]))).toThrow();
  });
});
