//go:build lithovm_chain_lab

package keeper

import (
	storetypes "cosmossdk.io/store/types"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	ethtypes "github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/params"
	"github.com/evmos/evmos/v20/x/evm/core/vm"
	"github.com/evmos/evmos/v20/x/evm/statedb"
	nativechain "lithic.local/native-chain-lab"
)

func TestLithoVMCandidateHookIsTaggedAndReregisters(t *testing.T) {
	config := *params.AllEthashProtocolChanges
	config.ChainID = big.NewInt(700777)
	sender := common.HexToAddress("0x09")
	evm := vm.NewEVM(vm.BlockContext{BlockNumber: big.NewInt(1), Time: big.NewInt(2)}, vm.TxContext{Origin: sender}, nil, &config, vm.Config{})
	message := ethtypes.NewMessage(sender, &nativechain.LabAddress, 7, big.NewInt(0), 1000000, big.NewInt(0), big.NewInt(0), big.NewInt(0), nil, nil, false)
	keeper := &Keeper{}
	if err := keeper.lithovmCandidateHook(message, &statedb.EVMConfig{ChainConfig: &config}, true)(evm, sender, nativechain.LabAddress); err == nil {
		t.Fatal("unmounted native store was accepted")
	}
	keeper.SetLithoVMStoreKey(storetypes.NewKVStoreKey("lithovm"))
	cfg := &statedb.EVMConfig{ChainConfig: &config}
	hook := keeper.lithovmCandidateHook(message, cfg, true)
	if hook == nil {
		t.Fatal("lab hook was not installed")
	}
	if err := hook(evm, sender, common.HexToAddress("0x01")); err != nil {
		t.Fatal(err)
	}
	if _, ok := evm.Precompile(nativechain.LabAddress); ok {
		t.Fatal("gateway registered for another recipient")
	}
	if err := hook(evm, sender, nativechain.LabAddress); err != nil {
		t.Fatal(err)
	}
	p, ok := evm.Precompile(nativechain.LabAddress)
	if !ok || p.(nativechain.LabPrecompile).Transaction.Nonce != 7 {
		t.Fatal("message nonce did not reach gateway")
	}
	evm.WithPrecompiles(nil, nil)
	if err := hook(evm, sender, nativechain.LabAddress); err != nil {
		t.Fatal(err)
	}
	if _, ok := evm.Precompile(nativechain.LabAddress); !ok {
		t.Fatal("gateway was not re-registered")
	}
	fake := ethtypes.NewMessage(sender, &nativechain.LabAddress, 7, big.NewInt(0), 1000000, big.NewInt(0), big.NewInt(0), big.NewInt(0), nil, nil, true)
	if err := keeper.lithovmCandidateHook(fake, cfg, true)(evm, sender, nativechain.LabAddress); err == nil {
		t.Fatal("fake message could commit")
	}
	if err := keeper.lithovmCandidateHook(fake, cfg, false)(evm, sender, nativechain.LabAddress); err != nil {
		t.Fatal(err)
	}
	p, ok = evm.Precompile(nativechain.LabAddress)
	if !ok || !p.(nativechain.LabPrecompile).Transaction.Simulated {
		t.Fatal("simulation mode missing")
	}
}
