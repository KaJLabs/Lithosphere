import 'dotenv/config';
import { createNativeVaultStatusApplication } from './nativeVaultStatusApplication.js';
import { createNativeVaultStatusProvider } from './nativeVaultStatusProvider.js';

if (process.env.MULTX_NATIVE_VAULT_STATUS_ENABLED !== 'true') {
  throw Error('native vault status service is disabled');
}

const parseJson = (name) => {
  const value = process.env[name];
  if (!value) throw Error(`${name} is required`);
  return JSON.parse(value);
};
const routes = parseJson('MULTX_NATIVE_VAULT_STATUS_ROUTES');
const rpcUrls = parseJson('MULTX_NATIVE_VAULT_STATUS_RPC_URLS');
const allowedOrigins = parseJson('MULTX_NATIVE_VAULT_STATUS_ORIGINS');
const port = Number(process.env.MULTX_NATIVE_VAULT_STATUS_PORT || 8188);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid native vault status port');
const providers = new Map();
for (const [id, rawUrl] of Object.entries(rpcUrls)) {
  const chainId = Number(id);
  const url = new URL(rawUrl);
  if (!Number.isSafeInteger(chainId) || chainId < 1 ||
      url.username || url.password || url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw Error('invalid native vault RPC configuration');
  }
  providers.set(chainId, createNativeVaultStatusProvider(url.href));
}

const app = createNativeVaultStatusApplication({ routes, providers, allowedOrigins });
app.listen(port, process.env.MULTX_NATIVE_VAULT_STATUS_BIND || '127.0.0.1', () => {
  console.log(`native vault status listening on port ${port}`);
});
