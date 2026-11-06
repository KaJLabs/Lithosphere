import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export interface WorkerPin { path: string; sha256: string }
export interface NativeWorkers {
  decode(receipt: unknown): Promise<Observation>;
  verify(request: unknown, address: string, record: Uint8Array): Promise<SourceMatch>;
}
export interface Registration {
  deploymentId: string; chainId: string; transactionHash: string; blockHash: string;
  blockHeight: string; creationIndex: number; contractAddress: string; codeHash: string;
  state: 'included'; verificationState: 'unverified'; canonicalProofVerified?: false;
}
export interface Observation {
  schemaVersion: 'lithovm-receipt-observation-v1'; chainId: string;
  transactionHash: string; blockHash: string; blockHeight: string;
  state: 'included' | 'failed'; canonicalProofVerified: false;
  deployments: Registration[]; events: unknown[];
}
export interface SourceMatch {
  sourceHash: string; rebuiltCodeHash: string; compilerVersion: string;
}

/** Local read-only workers. Executables must be owner-installed and not writable by the API user. */
export function pinnedNativeWorkers(options: {
  chainId: number; gateway: string; decoder: WorkerPin; verifier: WorkerPin;
  timeoutMs?: number; maxConcurrent?: number;
}): NativeWorkers {
  let active = 0;
  async function invoke(pin: WorkerPin, prepare: (directory: string) => Promise<string[]>): Promise<any> {
    if (active >= (options.maxConcurrent ?? 2)) throw new Error('Native worker busy');
    active++;
    let directory: string | undefined;
    try {
      if (!isAbsolute(pin.path) || !/^[0-9a-f]{64}$/.test(pin.sha256)) throw new Error('Invalid native worker pin');
      const stat = await lstat(pin.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024 * 1024) throw new Error('Invalid native worker file');
      if (createHash('sha256').update(await readFile(pin.path)).digest('hex') !== pin.sha256) throw new Error('Native worker hash mismatch');
      directory = await mkdtemp(join(tmpdir(), 'lithoscan-native-'));
      const args = await prepare(directory);
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(pin.path, args, { timeout: options.timeoutMs ?? 15_000, maxBuffer: 4 * 1024 * 1024,
          windowsHide: true, shell: false, encoding: 'utf8' }, (error, output) => {
          // Do not return stderr: failed source may be private and compiler diagnostics can quote it.
          if (error) reject(new Error('Native worker rejected input or was unavailable'));
          else resolve(output);
        });
      });
      return JSON.parse(stdout);
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
      active--;
    }
  }
  async function jsonFile(directory: string, name: string, value: unknown) {
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Native worker input exceeds limit');
    const path = join(directory, name);
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    return path;
  }
  return {
    decode: (receipt) => invoke(options.decoder, async (directory) => [
      'decode-receipt', await jsonFile(directory, 'receipt.json', receipt),
      '--chain-id', options.chainId.toString(), '--gateway', options.gateway]),
    verify: (request, address, record) => invoke(options.verifier, async (directory) => {
      if (record.length > 2 * 1024 * 1024) throw new Error('Native record exceeds limit');
      const requestPath = await jsonFile(directory, 'source.json', request);
      const recordPath = join(directory, 'record.bin');
      await writeFile(recordPath, record, { mode: 0o600, flag: 'wx' });
      return ['--native-record', requestPath, options.chainId.toString(), address, recordPath];
    }),
  };
}
