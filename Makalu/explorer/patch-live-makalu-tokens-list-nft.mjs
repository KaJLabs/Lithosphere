import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SEARCH_ROOTS = [process.cwd(), '/app'];
const CHUNK_DIR = path.join('.next', 'static', 'chunks', 'pages');
const CHUNK_PREFIX = 'tokens-';
const CHUNK_SUFFIX = '.js';

const PATCH_PATTERNS = [
  {
    name: 'native-label ternary',
    pattern: /"native"===([A-Za-z_$][\w$]*)\?"native":"LEP100"/g,
    replace: (_, variable) => `"native"===${variable}?"native":"ERC-721"===${variable}?"ERC-721":"LEP100"`,
  },
  {
    name: 'native-label ternary (hyphenated)',
    pattern: /"native"===([A-Za-z_$][\w$]*)\?"native":"LEP-100"/g,
    replace: (_, variable) => `"native"===${variable}?"native":"ERC-721"===${variable}?"ERC-721":"LEP-100"`,
  },
];

async function findChunkDir() {
  for (const root of SEARCH_ROOTS) {
    const candidate = path.join(root, CHUNK_DIR);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try next root.
    }
  }
  return null;
}

async function listTokenChunks(chunkDir) {
  const entries = await readdir(chunkDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(CHUNK_PREFIX) && entry.name.endsWith(CHUNK_SUFFIX))
    .map((entry) => path.join(chunkDir, entry.name));
}

async function patchChunk(filePath) {
  const original = await readFile(filePath, 'utf8');

  if (original.includes('"ERC-721"')) {
    return { filePath, status: 'already-patched' };
  }

  let patched = original;
  let appliedPattern = null;

  for (const candidate of PATCH_PATTERNS) {
    if (!candidate.pattern.test(patched)) {
      continue;
    }
    patched = patched.replace(candidate.pattern, candidate.replace);
    appliedPattern = candidate.name;
    break;
  }

  if (!appliedPattern || patched === original) {
    return { filePath, status: 'no-match' };
  }

  await writeFile(filePath, patched, 'utf8');
  return { filePath, status: 'patched', appliedPattern };
}

async function main() {
  const chunkDir = await findChunkDir();
  if (!chunkDir) {
    console.error('[patch-live] Could not find .next/static/chunks/pages under the current working directory or /app');
    process.exitCode = 1;
    return;
  }

  const chunks = await listTokenChunks(chunkDir);
  if (chunks.length === 0) {
    console.error(`[patch-live] No ${CHUNK_PREFIX}*${CHUNK_SUFFIX} files found in ${chunkDir}`);
    process.exitCode = 1;
    return;
  }

  let patchedCount = 0;
  let alreadyPatchedCount = 0;

  for (const chunk of chunks) {
    const result = await patchChunk(chunk);
    if (result.status === 'patched') {
      patchedCount += 1;
      console.log(`[patch-live] Patched ${path.basename(result.filePath)} using ${result.appliedPattern}`);
      continue;
    }
    if (result.status === 'already-patched') {
      alreadyPatchedCount += 1;
      console.log(`[patch-live] ${path.basename(result.filePath)} already contains ERC-721 labels`);
      continue;
    }
    console.warn(`[patch-live] No known NFT label pattern found in ${path.basename(result.filePath)}`);
  }

  if (patchedCount === 0 && alreadyPatchedCount === 0) {
    console.error('[patch-live] No chunks were patched. Rebuild the explorer from source if the live bundle shape has changed.');
    process.exitCode = 1;
    return;
  }

  console.log(`[patch-live] Complete. patched=${patchedCount} already_patched=${alreadyPatchedCount}`);
}

main().catch((error) => {
  console.error('[patch-live] Failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
