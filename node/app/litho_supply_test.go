// Copyright Tharsis Labs Ltd.(Evmos)
// SPDX-License-Identifier:ENCL-1.0(https://github.com/evmos/evmos/blob/main/LICENSE)

package app

import (
	"testing"

	sdk "github.com/cosmos/cosmos-sdk/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	"github.com/stretchr/testify/require"

	"github.com/evmos/evmos/v20/encoding"
	evmostypes "github.com/evmos/evmos/v20/types"
	"github.com/evmos/evmos/v20/utils"
)

func TestValidateLITHOGenesisSupply(t *testing.T) {
	encodingConfig := encoding.MakeConfig()
	testCases := []struct {
		name      string
		supply    sdk.Coin
		expectErr bool
	}{
		{
			name:   "exact fixed supply",
			supply: sdk.NewCoin(utils.BaseDenom, lithoMaximumSupply),
		},
		{
			name:      "below fixed genesis supply",
			supply:    sdk.NewCoin(utils.BaseDenom, lithoMaximumSupply.SubRaw(1)),
			expectErr: true,
		},
		{
			name:      "above maximum supply",
			supply:    sdk.NewCoin(utils.BaseDenom, lithoMaximumSupply.AddRaw(1)),
			expectErr: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			bankGenesis := banktypes.DefaultGenesisState()
			bankGenesis.Balances = []banktypes.Balance{{
				Address: "litho1genesisallocation",
				Coins:   sdk.NewCoins(tc.supply),
			}}
			bankGenesis.Supply = sdk.NewCoins(tc.supply)

			genesisState := evmostypes.GenesisState{
				banktypes.ModuleName: encodingConfig.Codec.MustMarshalJSON(bankGenesis),
			}
			err := validateLITHOGenesisSupply(encodingConfig.Codec, genesisState)
			if tc.expectErr {
				require.ErrorContains(t, err, "invalid LITHO genesis supply")
			} else {
				require.NoError(t, err)
			}
		})
	}
}
