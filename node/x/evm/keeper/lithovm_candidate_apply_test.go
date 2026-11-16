//go:build lithovm_chain_lab

package keeper_test

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"

	"cosmossdk.io/core/header"
	upgradetypes "cosmossdk.io/x/upgrade/types"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	evmostypes "github.com/evmos/evmos/v20/x/evm/types"
	nativechain "lithic.local/native-chain-lab"
)

// Compiled from integration/native-chain/testdata/counter.lithic at Lithic
// 4de97ab806ebec5b05c4eeab238281320b973f65. Keeping the artifact in this
// test makes the signed-message fixture independent of a sibling checkout.
// Compiler sourceHash (Keccak-256): ac549823aa139c6df36515d31a9e35a2959187998997f060d9a57e18f57c5c28.
const candidateCounterBytecode = "4c4954484f564d0c000200066e756d6265720100046e616d65060001000862616c616e63657300010402000100074368616e676564000100066e756d626572010003000a696e697469616c697a6500010103040002040000000102000002000101030000000000000000000000000000000000000000000000000000000000000001000373657400020103010400040400000001020000050000000100010200000b00010200010200010a000000036765740000010300010a0000"

// The regular Evmos transition reaches the tagged gateway call hook. A call
// to an unregistered empty account would succeed instead of failing decode.
func (suite *KeeperTestSuite) TestLithoVMCandidateApplyMessageHook() {
	suite.enableFeemarket = true
	defer func() { suite.enableFeemarket = false }()
	suite.SetupTest()
	ctx := suite.network.GetContext()
	sender := suite.keyring.GetKey(0)
	msg, err := suite.factory.GenerateGethCoreMsg(sender.Priv, evmostypes.EvmTxArgs{
		To: &nativechain.LabAddress, Amount: big.NewInt(0),
		Input: []byte{1, 2, 3, 4}, GasLimit: 1000000,
	})
	suite.Require().NoError(err)
	cfg, err := suite.network.App.EvmKeeper.EVMConfig(ctx, ctx.BlockHeader().ProposerAddress, suite.network.GetEIP155ChainID())
	suite.Require().NoError(err)
	txConfig := suite.network.App.EvmKeeper.TxConfig(ctx, common.Hash{})
	// LMX-C3: before the store upgrade is applied the gateway address is an ordinary empty account,
	// exactly as on rc3, so the same call succeeds without effect.
	before, err := suite.network.App.EvmKeeper.ApplyMessageWithConfig(ctx, msg, nil, false, cfg, txConfig)
	suite.Require().NoError(err)
	suite.Require().False(before.Failed(), before.VmError)
	suite.Require().NoError(suite.network.App.UpgradeKeeper.ApplyUpgrade(ctx.WithHeaderInfo(header.Info{Height: ctx.BlockHeight()}), upgradetypes.Plan{Name: "lithovm-native-store-v1", Height: ctx.BlockHeight()}))
	result, err := suite.network.App.EvmKeeper.ApplyMessageWithConfig(ctx, msg, nil, false, cfg, txConfig)
	suite.Require().NoError(err)
	suite.Require().NotNil(result)
	suite.Require().True(result.Failed())
	suite.Require().Contains(result.VmError, "invalid lab payload")
}

func (suite *KeeperTestSuite) TestLithoVMCandidateSignedDeploySimulationAndCommit() {
	suite.enableFeemarket = true
	defer func() { suite.enableFeemarket = false }()
	suite.SetupTest()
	{
		ctx := suite.network.GetContext()
		suite.Require().NoError(suite.network.App.UpgradeKeeper.ApplyUpgrade(ctx.WithHeaderInfo(header.Info{Height: ctx.BlockHeight()}), upgradetypes.Plan{Name: "lithovm-native-store-v1", Height: ctx.BlockHeight()}))
	}
	code, err := hex.DecodeString(candidateCounterBytecode)
	suite.Require().NoError(err)
	arguments, err := hex.DecodeString(fmt.Sprintf("4c56414c01000101%064x", 7))
	suite.Require().NoError(err)
	selector := crypto.Keccak256Hash([]byte("initialize(u64)"))
	payload, err := nativechain.EncodeGatewayDeploy(code, selector, arguments)
	suite.Require().NoError(err)
	ctx := suite.network.GetContext()
	sender := suite.keyring.GetKey(0)
	msg, err := suite.factory.GenerateGethCoreMsg(sender.Priv, evmostypes.EvmTxArgs{
		To: &nativechain.LabAddress, Amount: big.NewInt(0), Input: payload, GasLimit: 1000000,
	})
	suite.Require().NoError(err)
	cfg, err := suite.network.App.EvmKeeper.EVMConfig(ctx, ctx.BlockHeader().ProposerAddress, suite.network.GetEIP155ChainID())
	suite.Require().NoError(err)
	txConfig := suite.network.App.EvmKeeper.TxConfig(ctx, common.Hash{})
	simulated, err := suite.network.App.EvmKeeper.ApplyMessageWithConfig(ctx, msg, nil, false, cfg, txConfig)
	suite.Require().NoError(err)
	suite.Require().False(simulated.Failed(), simulated.VmError)
	nativeResult, err := nativechain.DecodeGatewayResult(simulated.Ret)
	suite.Require().NoError(err)
	suite.Require().Len(nativeResult, 40)
	address := hex.EncodeToString(nativeResult[20:])
	stateKey := []byte("lithovm/v1/contracts/" + address)
	key := suite.network.App.GetKey("lithovm")
	suite.Require().NotNil(key, "disabled candidate native store was not mounted")
	suite.Require().False(ctx.KVStore(suite.network.App.GetKey(evmostypes.StoreKey)).Has(stateKey), "EVM store unexpectedly held native state")
	suite.Require().False(ctx.KVStore(key).Has(stateKey), "simulation persisted native contract")
	for _, budget := range []uint64{9999999, 10000000, 10000001, 15000000, 30000000} {
		boundaryMsg, err := suite.factory.GenerateGethCoreMsg(sender.Priv, evmostypes.EvmTxArgs{
			To: &nativechain.LabAddress, Amount: big.NewInt(0), Input: payload, GasLimit: budget,
		})
		suite.Require().NoError(err)
		boundaryResult, err := suite.network.App.EvmKeeper.ApplyMessageWithConfig(ctx, boundaryMsg, nil, false, cfg, txConfig)
		suite.Require().NoError(err)
		suite.Require().False(boundaryResult.Failed(), "budget %d: %s", budget, boundaryResult.VmError)
		suite.Require().Equal(simulated.Ret, boundaryResult.Ret)
		// Keeper minimum gas multiplier can depend on the supplied limit.
		// The native bridge must not cause full-frame burn above its work cap.
		suite.Require().Less(boundaryResult.GasUsed, budget)
	}
	// Exercise the RPC-facing keeper estimator, without a network RPC server.
	from := suite.keyring.GetAddr(0)
	for _, cap := range []uint64{10000000, 30000000, 50000000} {
		for _, explicit := range []bool{false, true} {
			args := evmostypes.TransactionArgs{From: &from, To: &nativechain.LabAddress, Data: (*hexutil.Bytes)(&payload)}
			if explicit {
				gas := hexutil.Uint64(cap)
				args.Gas = &gas
			}
			encoded, err := json.Marshal(args)
			suite.Require().NoError(err)
			estimate, err := suite.network.App.EvmKeeper.EstimateGas(ctx, &evmostypes.EthCallRequest{Args: encoded, GasCap: cap})
			suite.Require().NoError(err, "cap=%d explicit=%v", cap, explicit)
			suite.Require().Empty(estimate.VmError)
			suite.Require().Greater(estimate.Gas, uint64(0))
			suite.Require().Less(estimate.Gas, uint64(1000000))
			estimatedMsg, err := suite.factory.GenerateGethCoreMsg(sender.Priv, evmostypes.EvmTxArgs{
				To: &nativechain.LabAddress, Amount: big.NewInt(0), Input: payload, GasLimit: estimate.Gas,
			})
			suite.Require().NoError(err)
			replayed, err := suite.network.App.EvmKeeper.ApplyMessageWithConfig(ctx, estimatedMsg, nil, false, cfg, txConfig)
			suite.Require().NoError(err)
			suite.Require().False(replayed.Failed(), replayed.VmError)
			suite.Require().Equal(simulated.Ret, replayed.Ret)
			suite.Require().False(ctx.KVStore(key).Has(stateKey), "estimation persisted deployment")
		}
	}
	committed, err := suite.network.App.EvmKeeper.ApplyMessageWithConfig(ctx, msg, nil, true, cfg, txConfig)
	suite.Require().NoError(err)
	suite.Require().False(committed.Failed(), committed.VmError)
	suite.Require().NotEmpty(committed.Logs)
	suite.Require().True(ctx.KVStore(key).Has(stateKey), "committed native contract missing")
	before := append([]byte(nil), ctx.KVStore(key).Get(stateKey)...)
	contract := common.HexToAddress("0x" + address)
	setSelector := crypto.Keccak256Hash([]byte("set(u64,bool)"))
	for _, profile := range []struct{ accepted bool }{{false}, {true}} {
		flag := 0
		if profile.accepted {
			flag = 1
		}
		setArgs, err := hex.DecodeString(fmt.Sprintf("4c56414c01000201%064x03%064x", 42, flag))
		suite.Require().NoError(err)
		setPayload, err := nativechain.EncodeGatewayCall(contract, setSelector, setArgs)
		suite.Require().NoError(err)
		setMsg, err := suite.factory.GenerateGethCoreMsg(sender.Priv, evmostypes.EvmTxArgs{
			To: &nativechain.LabAddress, Amount: big.NewInt(0), Input: setPayload, GasLimit: 1000000,
		})
		suite.Require().NoError(err)
		setResult, err := suite.network.App.EvmKeeper.ApplyMessageWithConfig(ctx, setMsg, nil, true, cfg, txConfig)
		suite.Require().NoError(err)
		if !profile.accepted {
			suite.Require().True(setResult.Failed(), "native require failure was accepted")
			suite.Require().True(bytes.Equal(before, ctx.KVStore(key).Get(stateKey)), "failed call changed native state")
		} else {
			suite.Require().False(setResult.Failed(), setResult.VmError)
			suite.Require().False(bytes.Equal(before, ctx.KVStore(key).Get(stateKey)), "recovery did not commit")
		}
	}
}
