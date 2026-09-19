// Caller holds the native_swaps row lock. Raw custody and wallet sends cannot mix.
export async function claimNativeDestinationMode(db,swapId,mode) {
  if(!['raw','injected'].includes(mode)) throw Error('invalid destination wallet mode');
  await db.query('INSERT INTO native_destination_wallet_modes(swap_id,mode) VALUES($1,$2) ON CONFLICT DO NOTHING',[swapId,mode]);
  if((await db.query('SELECT mode FROM native_destination_wallet_modes WHERE swap_id=$1',[swapId])).rows[0].mode!==mode) throw Error('destination wallet mode already fixed');
}
