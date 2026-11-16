//go:build !lithovm_chain_lab

package keeper

import (
	storetypes "cosmossdk.io/store/types"
	"github.com/evmos/evmos/v20/x/evm/core/core"
	"github.com/evmos/evmos/v20/x/evm/statedb"
	"github.com/evmos/evmos/v20/x/evm/types"
)

func (*Keeper) SetLithoVMStoreKey(storetypes.StoreKey) {}

// Ordinary chain builds do not install any LithoVM gateway.
func (*Keeper) lithovmCandidateHook(core.Message, *statedb.EVMConfig, bool) types.CallHook {
	return nil
}
