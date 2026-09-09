import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('Express and body-parser use patched qs for hostile constructor round trips', () => {
  // GHSA-4mjr-xmp4-gh2g: untrusted constructor/isBuffer values must not invoke a non-function.
  for (const parent of ['express', 'body-parser']) {
    const fromParent = createRequire(require.resolve(parent));
    const qs = fromParent('qs');
    const version = fromParent('qs/package.json').version;
    assert.equal(version, '6.16.0');
    for (const options of [{ plainObjects: true }, { allowPrototypes: true }]) {
      const parsed = qs.parse('item[constructor][isBuffer]=hostile', options);
      assert.doesNotThrow(() => qs.stringify(parsed));
    }
  }
});
