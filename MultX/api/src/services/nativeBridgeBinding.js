import { ethers } from 'ethers';

// The accepted bridge preserves the locked amount and user. A quote cannot
// authorize a custodian redirect or conversion inside the bridge attestation.
export function requireNativeBridgeBinding(lock, settlement) {
  if (!lock || !settlement || typeof lock.amount !== 'string' ||
      !/^[1-9][0-9]{0,77}$/.test(lock.amount) || settlement.amount !== lock.amount ||
      ethers.getAddress(settlement.holder) !== ethers.getAddress(lock.user)) {
    throw Error('bridge settlement must preserve source lock holder and amount');
  }
}
