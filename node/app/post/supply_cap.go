// Copyright Tharsis Labs Ltd.(Evmos)
// SPDX-License-Identifier:ENCL-1.0(https://github.com/evmos/evmos/blob/main/LICENSE)

package post

import (
	"context"
	"fmt"

	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

type supplyKeeper interface {
	GetSupply(ctx context.Context, denom string) sdk.Coin
}

// SupplyCapDecorator rejects a transaction whose completed state would place
// the configured native denomination above its permanent maximum supply.
type SupplyCapDecorator struct {
	bankKeeper supplyKeeper
	denom      string
	maxSupply  math.Int
}

func NewSupplyCapDecorator(bankKeeper supplyKeeper, denom string, maxSupply math.Int) sdk.PostDecorator {
	return SupplyCapDecorator{
		bankKeeper: bankKeeper,
		denom:      denom,
		maxSupply:  maxSupply,
	}
}

func (d SupplyCapDecorator) PostHandle(
	ctx sdk.Context,
	tx sdk.Tx,
	simulate,
	success bool,
	next sdk.PostHandler,
) (sdk.Context, error) {
	newCtx, err := next(ctx, tx, simulate, success)
	if err != nil {
		return newCtx, err
	}

	supply := d.bankKeeper.GetSupply(newCtx, d.denom)
	if supply.Amount.GT(d.maxSupply) {
		return newCtx, fmt.Errorf(
			"permanent supply cap exceeded for %s: maximum %s, got %s",
			d.denom,
			d.maxSupply,
			supply.Amount,
		)
	}

	return newCtx, nil
}
