import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const apiPrefix = 'MultX/api/';
const output = path.join(repository, 'MultX', 'api', 'review', 'runtime-source-manifest.json');
const tracked = execFileSync('git', ['ls-files', 'MultX/api'], {
  cwd: repository,
  encoding: 'utf8',
}).trim().split(/\r?\n/).filter(Boolean);

function excluded(relative) {
  return relative === '.env'
    || relative.startsWith('.env.')
    || relative === 'test'
    || relative.startsWith('test/')
    || relative === 'coverage'
    || relative.startsWith('coverage/')
    || relative === 'review'
    || relative.startsWith('review/')
    || relative.endsWith('.log')
    || path.posix.basename(relative).startsWith('dependency-') && relative.endsWith('.json');
}

const files = [];
for (const trackedPath of tracked) {
  const relative = trackedPath.slice(apiPrefix.length).replaceAll('\\', '/');
  if (excluded(relative)) continue;
  const absolute = path.join(repository, ...trackedPath.split('/'));
  const stat = await lstat(absolute);
  if (!stat.isFile()) throw new Error(`runtime source must be a regular file: ${trackedPath}`);
  const bytes = await readFile(absolute);
  files.push({
    path: relative,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
files.sort((left, right) => left.path.localeCompare(right.path));
await writeFile(output, `${JSON.stringify({ schema: 1, files }, null, 2)}\n`);
console.log(`runtime_source_files=${files.length}`);
console.log(`output=${path.relative(repository, output).replaceAll('\\', '/')}`);
