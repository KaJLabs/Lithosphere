// Disposable payout rehearsal only. No dotenv, remote networks or funded accounts.
module.exports = { solidity: '0.8.24', networks: { hardhat: { chainId: 9005, accounts: [], allowBlocksWithSameTimestamp: true } } };
