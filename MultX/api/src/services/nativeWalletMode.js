export async function claimNativeWalletMode(pool, swapId, mode, step, attemptId) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout='5s'");
    const swap = (await db.query('SELECT state FROM native_swaps WHERE swap_id=$1 FOR UPDATE', [swapId])).rows[0];
    if (swap?.state !== 'awaiting_settlement') throw Error('source not awaiting settlement');
    await db.query('INSERT INTO native_wallet_modes(swap_id,mode) VALUES($1,$2) ON CONFLICT DO NOTHING', [swapId, mode]);
    if ((await db.query('SELECT mode FROM native_wallet_modes WHERE swap_id=$1', [swapId])).rows[0].mode !== mode) throw Error('wallet mode already fixed');
    let granted;
    if (attemptId) {
      if ((await db.query('SELECT step FROM native_source_transactions WHERE swap_id=$1 AND step=$2', [swapId, step])).rowCount) granted = false;
      else granted = (await db.query('INSERT INTO native_wallet_attempts(swap_id,step,attempt_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING attempt_id', [swapId, step, attemptId])).rowCount === 1;
    }
    await db.query('COMMIT');
    return { granted };
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
