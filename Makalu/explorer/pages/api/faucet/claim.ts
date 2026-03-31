import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';

type WalletType = 'EVM' | 'COSMOS' | 'WEB3';

type ClaimBody = {
  address?: string;
  walletType?: WalletType;
  amount?: string;
  reason?: string;
  signature?: string;
};

type ClaimResponse = {
  ok: boolean;
  txHash?: string;
  message?: string;
  cooldownSeconds?: number;
};

const COOLDOWN_SECONDS = 60 * 60; // 1 hour
const MAX_REQUESTS_PER_IP_WINDOW = 10;
const IP_WINDOW_SECONDS = 60 * 15; // 15 min
const MAX_REASON_LENGTH = 500;
const ALLOWED_AMOUNTS = new Set(['10 LITHO', '25 LITHO', '50 LITHO']);

// In-memory stores (demo only — replace with Redis in production)
const addressCooldownStore = new Map<string, number>();
const ipWindowStore = new Map<string, { count: number; resetAt: number }>();

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function getClientIp(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
  const realIp = req.headers['x-real-ip'];
  if (realIp) return (Array.isArray(realIp) ? realIp[0] : realIp).trim();
  return req.socket?.remoteAddress || 'unknown';
}

function sanitizeAddress(address: string): string {
  return address.trim();
}

function isLikelyEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function isLikelyCosmosAddress(address: string): boolean {
  return /^[a-z0-9]{20,90}$/.test(address) && !address.startsWith('0x');
}

function enforceIpRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = nowSec();
  const existing = ipWindowStore.get(ip);

  if (!existing || now >= existing.resetAt) {
    ipWindowStore.set(ip, { count: 1, resetAt: now + IP_WINDOW_SECONDS });
    return { allowed: true };
  }

  if (existing.count >= MAX_REQUESTS_PER_IP_WINDOW) {
    return { allowed: false, retryAfter: existing.resetAt - now };
  }

  existing.count += 1;
  ipWindowStore.set(ip, existing);
  return { allowed: true };
}

function enforceAddressCooldown(address: string): { allowed: boolean; retryAfter?: number } {
  const now = nowSec();
  const nextAllowedAt = addressCooldownStore.get(address);
  if (nextAllowedAt && now < nextAllowedAt) {
    return { allowed: false, retryAfter: nextAllowedAt - now };
  }
  return { allowed: true };
}

function setAddressCooldown(address: string) {
  addressCooldownStore.set(address, nowSec() + COOLDOWN_SECONDS);
}

function buildOwnershipMessage(address: string, amount: string): string {
  return `Lithosphere Makalu faucet claim\nAddress: ${address}\nAmount: ${amount}`;
}

async function verifyEvmSignature(params: {
  address: string;
  amount: string;
  signature?: string;
}): Promise<boolean> {
  const { address, amount, signature } = params;
  if (!signature) return true;
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) return false;
  const message = buildOwnershipMessage(address, amount);
  return message.length > 0 && isLikelyEvmAddress(address);
}

async function mockSendFaucetTx(params: {
  address: string;
  walletType: WalletType;
  amount: string;
}): Promise<{ txHash: string }> {
  const seed = `${params.address}|${params.walletType}|${params.amount}|${Date.now()}`;
  const txHash = '0x' + crypto.createHash('sha256').update(seed).digest('hex');
  return { txHash };
}

function validateBody(
  body: ClaimBody
): { ok: true; value: Required<ClaimBody> } | { ok: false; message: string } {
  const address = sanitizeAddress(body.address || '');
  const walletType = body.walletType;
  const amount = (body.amount || '').trim();
  const reason = (body.reason || '').trim();
  const signature = (body.signature || '').trim();

  if (!address) return { ok: false, message: 'Wallet address is required.' };
  if (walletType !== 'EVM' && walletType !== 'COSMOS' && walletType !== 'WEB3') {
    return { ok: false, message: 'Invalid wallet type.' };
  }
  if (!ALLOWED_AMOUNTS.has(amount)) {
    return { ok: false, message: 'Invalid faucet amount requested.' };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, message: 'Reason is too long.' };
  }
  if ((walletType === 'EVM' || walletType === 'WEB3') && !isLikelyEvmAddress(address)) {
    return { ok: false, message: 'Invalid EVM wallet address.' };
  }
  if (walletType === 'COSMOS' && !isLikelyCosmosAddress(address)) {
    return { ok: false, message: 'Invalid Cosmos wallet address.' };
  }

  return { ok: true, value: { address, walletType, amount, reason, signature } };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ClaimResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed.' });
  }

  try {
    const ip = getClientIp(req);
    const ipRate = enforceIpRateLimit(ip);
    if (!ipRate.allowed) {
      return res.status(429).json({
        ok: false,
        message: 'Too many requests from this IP. Try again later.',
        cooldownSeconds: ipRate.retryAfter,
      });
    }

    const body = req.body as ClaimBody;
    const parsed = validateBody(body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, message: parsed.message });
    }

    const { address, walletType, amount, reason, signature } = parsed.value;

    const addressCooldown = enforceAddressCooldown(address);
    if (!addressCooldown.allowed) {
      return res.status(429).json({
        ok: false,
        message: 'This wallet is still on cooldown.',
        cooldownSeconds: addressCooldown.retryAfter,
      });
    }

    if (walletType === 'EVM' || walletType === 'WEB3') {
      const signatureOk = await verifyEvmSignature({ address, amount, signature });
      if (!signatureOk) {
        return res.status(401).json({ ok: false, message: 'Signature verification failed.' });
      }
    }

    void reason;

    const sent = await mockSendFaucetTx({ address, walletType, amount });
    setAddressCooldown(address);

    return res.status(200).json({
      ok: true,
      txHash: sent.txHash,
      message: `Faucet request accepted. ${amount} queued for ${address}.`,
      cooldownSeconds: COOLDOWN_SECONDS,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || 'Internal server error.' });
  }
}
