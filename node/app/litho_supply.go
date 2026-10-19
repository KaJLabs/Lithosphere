// Copyright Tharsis Labs Ltd.(Evmos)
// SPDX-License-Identifier:ENCL-1.0(https://github.com/evmos/evmos/blob/main/LICENSE)

package app

import (
	"context"
	"fmt"

	"cosmossdk.io/math"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"

	evmostypes "github.com/evmos/evmos/v20/types"
	"github.com/evmos/evmos/v20/utils"
)

var lithoMaximumSupply = math.NewInt(1_000_000_000).Mul(evmostypes.PowerReduction)

// LITHOMaximumSupply returns the immutable native-token supply cap. The value
// is exposed so integration fixtures can construct a valid LITHO genesis.
func LITHOMaximumSupply() math.Int {
	return lithoMaximumSupply
}

func rejectInflationMinting(_ context.Context, coins sdk.Coins) error {
	if coins.Empty() {
		return nil
	}

	return fmt.Errorf("LITHO inflation minting is permanently disabled: %s", coins)
}

func validateLITHOGenesisSupply(cdc codec.JSONCodec, genesisState evmostypes.GenesisState) error {
	bankGenesis := banktypes.GetGenesisStateFromAppState(cdc, genesisState)
	totalSupply := sdk.NewCoins()
	for _, balance := range bankGenesis.Balances {
		totalSupply = totalSupply.Add(balance.Coins...)
	}

	lithoSupply := totalSupply.AmountOf(utils.BaseDenom)
	if !lithoSupply.Equal(lithoMaximumSupply) {
		return fmt.Errorf(
			"invalid LITHO genesis supply: expected exactly %s%s, got %s%s",
			lithoMaximumSupply,
			utils.BaseDenom,
			lithoSupply,
			utils.BaseDenom,
		)
	}

	return nil
}
