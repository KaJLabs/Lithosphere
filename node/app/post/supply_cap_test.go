// Copyright Tharsis Labs Ltd.(Evmos)
// SPDX-License-Identifier:ENCL-1.0(https://github.com/evmos/evmos/blob/main/LICENSE)

package post

import (
	"context"
	"testing"

	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/stretchr/testify/require"
)

type fixedSupplyKeeper struct {
	supply sdk.Coin
}

func (k fixedSupplyKeeper) GetSupply(_ context.Context, _ string) sdk.Coin {
	return k.supply
}

func TestSupplyCapDecorator(t *testing.T) {
	const denom = "ulitho"
	maxSupply := math.NewInt(1_000)
	testCases := []struct {
		name      string
		supply    math.Int
		expectErr bool
	}{
		{name: "below cap", supply: math.NewInt(999)},
		{name: "at cap", supply: math.NewInt(1_000)},
		{name: "above cap", supply: math.NewInt(1_001), expectErr: true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			decorator := NewSupplyCapDecorator(
				fixedSupplyKeeper{supply: sdk.NewCoin(denom, tc.supply)},
				denom,
				maxSupply,
			)
			_, err := decorator.PostHandle(
				sdk.Context{},
				nil,
				false,
				true,
				func(ctx sdk.Context, _ sdk.Tx, _, _ bool) (sdk.Context, error) {
					return ctx, nil
				},
			)
			if tc.expectErr {
				require.ErrorContains(t, err, "permanent supply cap exceeded")
			} else {
				require.NoError(t, err)
			}
		})
	}
}
