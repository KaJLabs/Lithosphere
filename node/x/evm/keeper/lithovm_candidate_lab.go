//go:build lithovm_chain_lab

package keeper

import (
	storetypes "cosmossdk.io/store/types"
	"errors"
	"github.com/ethereum/go-ethereum/common"
	"github.com/evmos/evmos/v20/x/evm/core/core"
	"github.com/evmos/evmos/v20/x/evm/core/vm"
	"github.com/evmos/evmos/v20/x/evm/statedb"
	"github.com/evmos/evmos/v20/x/evm/types"
	nativechain "lithic.local/native-chain-lab"
)

func (k *Keeper) SetLithoVMStoreKey(key storetypes.StoreKey) { k.lithovmStoreKey = key }

// The candidate is visible only with the lab build tag. Re-register on every
// gateway call because Evmos can replace its active precompile map in the
// ordinary precompile hook after an intervening call.
func (k *Keeper) lithovmCandidateHook(msg core.Message, cfg *statedb.EVMConfig, commit bool) types.CallHook {
	return func(evm *vm.EVM, _ common.Address, recipient common.Address) error {
		if recipient != nativechain.LabAddress {
			return nil
		}
		if k.lithovmStoreKey == nil {
			return errors.New("native store is not mounted")
		}
		return nativechain.RegisterLabForMessage(evm, k.lithovmStoreKey, msg, cfg.ChainConfig.ChainID, commit)
	}
}
