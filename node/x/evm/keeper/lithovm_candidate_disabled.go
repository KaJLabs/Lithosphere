//go:build !lithovm_chain_lab

package keeper

import (
	storetypes "cosmossdk.io/store/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/evmos/evmos/v20/x/evm/core/core"
	"github.com/evmos/evmos/v20/x/evm/statedb"
	"github.com/evmos/evmos/v20/x/evm/types"
)

func (*Keeper) SetLithoVMStoreKey(storetypes.StoreKey) {}

func (*Keeper) SetLithoVMActivation(func(sdk.Context) bool) {}

func (*Keeper) lithovmActive(sdk.Context) bool { return false }

// Ordinary chain builds do not install any LithoVM gateway.
func (*Keeper) lithovmCandidateHook(core.Message, *statedb.EVMConfig, bool) types.CallHook {
	return nil
}
