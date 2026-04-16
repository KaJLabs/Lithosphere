import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const sourceTemplatesDir = path.resolve(packageRoot, '..', '..', 'templates');
const outputTemplatesDir = path.join(packageRoot, 'dist', 'templates');

const EXCLUDED_TEMPLATE_PATH_PARTS = new Set([
  '.turbo',
  'artifacts',
  'broadcast',
  'cache',
  'coverage',
  'dist',
  'forge-cache',
  'node_modules',
  'typechain-types',
]);

function shouldInclude(relativePath) {
  if (!relativePath || relativePath === '.') {
    return true;
  }

  return relativePath
    .split(path.sep)
    .every((segment) => segment && !EXCLUDED_TEMPLATE_PATH_PARTS.has(segment));
}

await rm(outputTemplatesDir, { force: true, recursive: true });
await mkdir(outputTemplatesDir, { recursive: true });

await cp(sourceTemplatesDir, outputTemplatesDir, {
  recursive: true,
  filter: (sourcePath) => shouldInclude(path.relative(sourceTemplatesDir, sourcePath)),
});

console.log(`Bundled templates into ${path.relative(packageRoot, outputTemplatesDir)}`);
