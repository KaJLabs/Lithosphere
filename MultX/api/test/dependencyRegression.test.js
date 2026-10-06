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

test('Express proxy trust rejects an IPv4-mapped IPv6 subnet with an unsafe prefix', () => {
  // GHSA-jqcg-44mw-7w3h: this malformed /8 must not trust every IPv4 client.
  const fromExpress = createRequire(require.resolve('express'));
  const proxyaddr = fromExpress('proxy-addr');
  assert.equal(fromExpress('proxy-addr/package.json').version, '2.0.8');
  assert.equal(proxyaddr.compile('::ffff:10.0.0.0/8')('192.0.2.1', 0), false);
  assert.equal(proxyaddr.compile('::ffff:10.0.0.0/104')('10.1.2.3', 0), true);
});
