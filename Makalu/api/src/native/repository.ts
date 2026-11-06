import type { Pool } from 'pg';
import type { NativeSourceRepository, VerifiedSource } from './contracts.js';

/** Apply the accompanying migration before installing this disabled integration. */
export function postgresNativeSources(pool: Pool): NativeSourceRepository {
  return {
    async put(value) {
      const r = value.registration;
      await pool.query(`INSERT INTO native_source_matches
        (deployment_id, chain_id, contract_address, block_hash, block_height, evidence, canonical)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,true)
        ON CONFLICT (deployment_id) DO UPDATE SET evidence=EXCLUDED.evidence, canonical=true`,
      [r.deploymentId, r.chainId, r.contractAddress, r.blockHash, r.blockHeight, JSON.stringify(value)]);
    },
    async get(chainId, contract) {
      const result = await pool.query<{ evidence: VerifiedSource }>(`SELECT evidence FROM native_source_matches
        WHERE chain_id=$1 AND contract_address=$2 AND canonical=true
        ORDER BY block_height DESC, deployment_id LIMIT 1`, [chainId.toString(), contract]);
      return result.rows[0]?.evidence ?? null;
    },
    async invalidate(chainId, blockHash) {
      await pool.query('UPDATE native_source_matches SET canonical=false WHERE chain_id=$1 AND block_hash=$2',
        [chainId.toString(), blockHash]);
    },
  };
}
