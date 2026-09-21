import express from 'express';
import { ethers } from 'ethers';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

const router = express.Router();

// Canonical LITHO-side token. Production obtains this only from the validated
// mainnet network manifest; the historical env/default path is development-only.
const LITHO_TOKEN = config.lithoTokenAddress || '';

// On-chain contract bytecode at a fixed address is immutable, so cache the
// deployment probe instead of hitting the RPC on every /health poll. A positive
// (both deployed) result is cached long; not-yet-confirmed / errored results
// re-check quickly so a transient RPC blip self-heals.
let _cache = { at: 0, data: null };
const POS_TTL_MS = 5 * 60 * 1000; // 5 min once both are confirmed deployed
const NEG_TTL_MS = 30 * 1000;     // 30 s while unconfirmed / on RPC error

const isDeployed = (code) =>
  typeof code === 'string' && code !== '0x' && code !== '0x0';

async function getDeploymentStatus() {
  if (!config.multxEnabled) {
    return {
      bridgeAddress: '',
      lithoTokenAddress: '',
      kametTokenAddress: '',
      bridgeContractDeployed: false,
      kametTokenContractDeployed: false,
      error: '',
    };
  }
  const now = Date.now();
  const confirmed =
    _cache.data &&
    _cache.data.bridgeContractDeployed &&
    _cache.data.kametTokenContractDeployed;
  const ttl = confirmed ? POS_TTL_MS : NEG_TTL_MS;
  if (_cache.data && now - _cache.at < ttl) return _cache.data;

  const bridgeAddress = config.bridgeAddress || '';
  const lithoTokenAddress = LITHO_TOKEN;
  let bridgeContractDeployed = false;
  let kametTokenContractDeployed = false;
  let error = '';

  try {
    const provider = new ethers.JsonRpcProvider(config.lithoRpcHttp);
    const [bridgeCode, tokenCode] = await Promise.all([
      bridgeAddress ? provider.getCode(bridgeAddress) : Promise.resolve('0x'),
      lithoTokenAddress ? provider.getCode(lithoTokenAddress) : Promise.resolve('0x'),
    ]);
    bridgeContractDeployed = isDeployed(bridgeCode);
    kametTokenContractDeployed = isDeployed(tokenCode);
  } catch (err) {
    error = err?.message || String(err);
  }

  const data = {
    bridgeAddress,
    lithoTokenAddress,
    // Deprecated compatibility field for existing testnet explorer clients.
    kametTokenAddress: lithoTokenAddress,
    bridgeContractDeployed,
    kametTokenContractDeployed,
    error,
  };
  _cache = { at: now, data };
  return data;
}

// GET /health
router.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const deployment = await getDeploymentStatus();
    res.json({
      status: 'ok',
      db: 'ok',
      multx: config.multxEnabled ? 'enabled' : 'disabled',
      deployment,
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      db: 'error',
      message: err.message,
    });
  }
});

export default router;
