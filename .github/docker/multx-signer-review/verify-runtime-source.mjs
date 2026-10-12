import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MULTX_SOURCE_ROOT || '/app';
const manifestPath = process.env.MULTX_SOURCE_MANIFEST
  || '/usr/local/share/multx-runtime-source-manifest.json';
const verifierPath = fileURLToPath(import.meta.url);
const manifestBytes = await fs.readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const expected = new Map(manifest.files.map((item) => [item.path, item]));
const actual = [];

async function walk(directory, relative = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!relative && entry.name === 'node_modules') continue;
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink not permitted in runtime source: ${childRelative}`);
    if (entry.isDirectory()) await walk(full, childRelative);
    else if (entry.isFile()) actual.push(childRelative);
  }
}

await walk(root);
actual.sort();
let verified = 0;
const missing = [];
const mismatched = [];
for (const [relative, item] of expected) {
  try {
    const bytes = await fs.readFile(path.join(root, ...relative.split('/')));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== item.bytes || digest !== item.sha256) mismatched.push(relative);
    else verified += 1;
  } catch (error) {
    if (error?.code === 'ENOENT') missing.push(relative);
    else throw error;
  }
}
const unlisted = actual.filter((relative) => !expected.has(relative));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const verifierBytes = await fs.readFile(verifierPath);

console.log(`capture_utc=${new Date().toISOString()}`);
console.log(`manifest_sha256=${sha256(manifestBytes)}`);
console.log(`verifier_sha256=${sha256(verifierBytes)}`);
console.log(`declared_files=${expected.size}`);
console.log(`image_source_files=${actual.length}`);
console.log(`verified_files=${verified}`);
console.log(`missing_files=${missing.length}`);
console.log(`mismatched_files=${mismatched.length}`);
console.log(`unlisted_files=${unlisted.length}`);
for (const name of missing) console.log(`missing=${name}`);
for (const name of mismatched) console.log(`mismatched=${name}`);
for (const name of unlisted) console.log(`unlisted=${name}`);

if (!expected.size || verified !== expected.size || missing.length || mismatched.length || unlisted.length) {
  process.exitCode = 1;
} else {
  console.log('result=PASS');
}
