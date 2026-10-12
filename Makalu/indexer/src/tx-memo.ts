/** Read TxRaw.body_bytes -> TxBody.memo without interpreting any signed messages. */
export function decodeTxMemo(raw: Uint8Array): string {
  function bytesField(bytes: Uint8Array, wanted: number): Uint8Array | undefined {
    let offset = 0;
    let found: Uint8Array | undefined;
    const varint = (): number => {
      let value = 0;
      let factor = 1;
      for (let i = 0; i < 10 && offset < bytes.length; i++) {
        const byte = bytes[offset++];
        value += (byte & 127) * factor;
        if (!(byte & 128)) {
          if (!Number.isSafeInteger(value)) throw new Error('Oversized protobuf value');
          return value;
        }
        factor *= 128;
      }
      throw new Error('Invalid protobuf varint');
    };
    while (offset < bytes.length) {
      const tag = varint();
      const field = Math.floor(tag / 8);
      if (!field) throw new Error('Invalid protobuf field');
      switch (tag % 8) {
        case 0: varint(); break;
        case 1: offset += 8; break;
        case 2: {
          const length = varint();
          const end = offset + length;
          if (end > bytes.length) throw new Error('Truncated protobuf field');
          // Protobuf singular fields use the last value if repeated on the wire.
          if (field === wanted) found = bytes.subarray(offset, end);
          offset = end;
          break;
        }
        case 5: offset += 4; break;
        default: throw new Error('Unsupported protobuf wire type');
      }
      if (offset > bytes.length) throw new Error('Truncated protobuf field');
    }
    return found;
  }
  const body = bytesField(raw, 1);
  const memo = body && bytesField(body, 2);
  return memo ? new TextDecoder('utf-8', { fatal: true }).decode(memo) : '';
}
