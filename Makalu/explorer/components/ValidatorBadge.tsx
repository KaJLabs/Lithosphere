import { NETWORK } from '@/lib/network';
import type { ApiValidator } from '@/lib/types';
import { validatorBadge } from '@/lib/validator-profiles';

export default function ValidatorBadge({ validator }: { validator: ApiValidator }) {
  const badge = validatorBadge(validator, NETWORK.isMainnet);
  if (!badge) return null;
  const description = badge === 'Genesis'
    ? 'Confirmed mainnet genesis validator'
    : badge === 'Post-genesis'
      ? 'Approved post-genesis validator; registration and bonding confirmed by indexed chain state'
      : 'Approved post-genesis candidate; onboarding is pending bonded, non-jailed chain confirmation';
  return <span className="badge-neutral" title={description}>{badge}</span>;
}
