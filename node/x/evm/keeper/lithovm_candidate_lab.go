//go:build lithovm_chain_lab

package keeper

import (
	storetypes "cosmossdk.io/store/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"errors"
	"github.com/ethereum/go-ethereum/common"
	"github.com/evmos/evmos/v20/x/evm/core/core"
	"github.com/evmos/evmos/v20/x/evm/core/vm"
	"github.com/evmos/evmos/v20/x/evm/statedb"
	"github.com/evmos/evmos/v20/x/evm/types"
	nativechain "lithic.local/native-chain-lab"
)

func (k *Keeper) SetLithoVMStoreKey(key storetypes.StoreKey) { k.lithovmStoreKey = key }

// SetLithoVMActivation installs the activation gate (LMX-C3). The gateway call hook is installed
// only when it reports true; before that a call to the gateway address is an ordinary call to an
// account without code, exactly as in rc3.
func (k *Keeper) SetLithoVMActivation(active func(sdk.Context) bool) { k.lithovmActivation = active }

func (k *Keeper) lithovmActive(ctx sdk.Context) bool {
	return k.lithovmActivation != nil && k.lithovmActivation(ctx)
}

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
