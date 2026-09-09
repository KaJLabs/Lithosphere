const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { assertBuildSources } = require('../scripts/mainnet/generate-bytecode-evidence');

describe('M-03 byte-exact compiler source identity', function () {
  let root, commit;
  beforeEach(function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-source-'));
    const git = args => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init']);
    fs.mkdirSync(path.join(root, 'contracts'));
    fs.writeFileSync(path.join(root, '.gitattributes'), '* text eol=lf\n');
    fs.writeFileSync(path.join(root, 'contracts/Test.sol'), 'line one\nline two\n');
    git(['add', '.']); git(['-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture']);
    commit = git(['rev-parse', 'HEAD']).toString().trim();
  });
  afterEach(function () { fs.rmSync(root, { recursive: true, force: true }); });
  const input = content => ({ solcLongVersion: '0.8.24+commit.e11b9ed9', input: { sources: { 'contracts/Test.sol': { content } } } });
  it('accepts exact committed bytes and rejects CRLF even when build and local source agree', function () {
    expect(() => assertBuildSources(input('line one\nline two\n'), root, commit)).not.to.throw();
    fs.writeFileSync(path.join(root, 'contracts/Test.sol'), 'line one\r\nline two\r\n');
    expect(() => assertBuildSources(input('line one\r\nline two\r\n'), root, commit)).to.throw('source bytes differ from immutable commit');
  });
  it('rejects stale compiler inputs even when the checkout matches the commit', function () {
    expect(() => assertBuildSources(input('stale\n'), root, commit)).to.throw('stale compiler input');
  });
});
