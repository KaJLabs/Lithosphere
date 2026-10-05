// Approved public mainnet metadata only. Infrastructure and unapproved branding
// must never be added here. Registration/bonding comes from indexed chain state.
export const MAINNET_VALIDATOR_PROFILES: Readonly<Record<string, { name: string; genesis: boolean }>> = {
  lithovaloper1hg4klgm4s2tv2gmjxke27waz49knd2rq5tzfcw: { name: 'Existing Validator', genesis: true },
  lithovaloper15levtumahvjgysxmc2wq4mc2zxh3mmrdwl9rk0: { name: 'Everest Nodes', genesis: false },
  lithovaloper1rfr6g3vf8p72wqx585lgndvg62pzllre0vvx80: { name: 'CloudQuorum Edge Systems', genesis: false },
  lithovaloper14c3y86hfd69kwqmdkup9y90ertu53cu6g2yhgn: { name: 'NodeHarbor Technologies', genesis: false },
  lithovaloper1967lzyr6kpt5z2qsff603v86fhan6ynteys3t3: { name: 'VantaVortex Computing', genesis: false },
};

export function validatorProfile(address: string, isMainnet: boolean) {
  return isMainnet && Object.prototype.hasOwnProperty.call(MAINNET_VALIDATOR_PROFILES, address)
    ? MAINNET_VALIDATOR_PROFILES[address]
    : undefined;
}

export function validatorBadge(
  validator: { address: string; status: string; jailed?: boolean },
  isMainnet: boolean,
): 'Genesis' | 'Staged' | 'Post-genesis' | null {
  const profile = validatorProfile(validator.address, isMainnet);
  if (!profile) return null;
  if (profile.genesis) return 'Genesis';
  // A registered bonded validator proves successful creation in chain state.
  // Do not promote based on approval, name, or an ambiguous "active" label.
  return validator.jailed === false && ['Bonded', 'BOND_STATUS_BONDED'].includes(validator.status)
    ? 'Post-genesis'
    : 'Staged';
}
