#!/usr/bin/env node

const STORE_URL =
  'https://chromewebstore.google.com/detail/thanos-wallet/jajfgpnlaoakklhnnchdpiglmkkpcehj?hl=en';
const SOURCE_REPOSITORY = 'imasssad/Thanos-Wallet';
const EXPECTED_VERSION = '0.9.40';
const EXPECTED_SOURCE_COMMIT = '13f7a25be34aeef1a7a3fc668d8e33b4b531ff8a';
const SIGNIN_URL = 'https://makalu.litho.ai/signin';
const AUTH_ME_URL = 'https://makalu.litho.ai/api/auth/me';
const RPC_URL = 'https://rpc.litho.ai';
const EXPECTED_CHAIN_ID = '0xab169';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchResponse(url, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      'user-agent': 'lithosphere-thanos-acceptance-preflight/1.0',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
}

async function fetchText(url, expectedStatus = 200) {
  const response = await fetchResponse(url);
  assert(response.status === expectedStatus, `${url} returned HTTP ${response.status}`);
  return response.text();
}

function rawSourceUrl(path) {
  return `https://raw.githubusercontent.com/${SOURCE_REPOSITORY}/${EXPECTED_SOURCE_COMMIT}/${path}`;
}

async function main() {
  const storeHtml = await fetchText(STORE_URL);
  const publishedVersion = storeHtml.match(
    /<div class="QDHp8e">Version<\/div><div class="nBZElf">([^<]+)<\/div>/,
  )?.[1];
  const publishedUpdatedDate = storeHtml.match(
    /<div class="QDHp8e">Updated<\/div><div>([^<]+)<\/div>/,
  )?.[1];
  assert(publishedVersion, 'Unable to read the Chrome Web Store version');
  assert(
    publishedVersion === EXPECTED_VERSION,
    `Published Thanos version changed: expected ${EXPECTED_VERSION}, received ${publishedVersion}`,
  );

  const sourcePackage = JSON.parse(
    await fetchText(rawSourceUrl('apps/extension/package.json')),
  );
  assert(
    sourcePackage.version === EXPECTED_VERSION,
    `Pinned source declares ${sourcePackage.version}, expected ${EXPECTED_VERSION}`,
  );

  const injectedSource = await fetchText(
    rawSourceUrl('apps/extension/src/entrypoints/injected.ts'),
  );
  for (const requiredMarker of [
    'fi.thanos.wallet',
    'eip6963:announceProvider',
    "Object.defineProperty(window, 'thanos'",
    'personal_sign',
  ]) {
    assert(
      injectedSource.includes(requiredMarker),
      `Pinned source is missing required provider marker: ${requiredMarker}`,
    );
  }

  const signinResponse = await fetchResponse(SIGNIN_URL);
  assert(signinResponse.status === 200, `/signin returned HTTP ${signinResponse.status}`);

  const authMeResponse = await fetchResponse(AUTH_ME_URL);
  assert(
    authMeResponse.status === 401,
    `Unauthenticated /api/auth/me returned HTTP ${authMeResponse.status}, expected 401`,
  );

  const rpcResponse = await fetchResponse(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  });
  assert(rpcResponse.status === 200, `Makalu RPC returned HTTP ${rpcResponse.status}`);
  const rpcPayload = await rpcResponse.json();
  assert(
    String(rpcPayload.result).toLowerCase() === EXPECTED_CHAIN_ID,
    `Makalu RPC returned chain ID ${rpcPayload.result ?? 'missing'}, expected ${EXPECTED_CHAIN_ID}`,
  );

  console.log(
    JSON.stringify(
      {
        status: 'pass',
        checkedAt: new Date().toISOString(),
        publishedVersion,
        publishedUpdatedDate,
        sourceCommit: EXPECTED_SOURCE_COMMIT,
        sourceProviderMarkers: 'pass',
        signinHttpStatus: signinResponse.status,
        unauthenticatedAuthMeHttpStatus: authMeResponse.status,
        evmChainIdHex: EXPECTED_CHAIN_ID,
        evmChainIdDecimal: Number.parseInt(EXPECTED_CHAIN_ID.slice(2), 16),
        transactionSubmitted: false,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`Thanos acceptance preflight failed: ${error.message}`);
  process.exitCode = 1;
});
