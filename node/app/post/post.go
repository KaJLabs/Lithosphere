// Copyright Tharsis Labs Ltd.(Evmos)
// SPDX-License-Identifier:ENCL-1.0(https://github.com/evmos/evmos/blob/main/LICENSE)

package post

import (
	"errors"

	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"
	bankkeeper "github.com/cosmos/cosmos-sdk/x/bank/keeper"
)

// HandlerOptions are the options required for constructing a PostHandler.
type HandlerOptions struct {
	FeeCollectorName string
	BankKeeper       bankkeeper.Keeper
	SupplyCapDenom   string
	SupplyCapAmount  math.Int
}

func (h HandlerOptions) Validate() error {
	if h.FeeCollectorName == "" {
		return errors.New("fee collector name cannot be empty")
	}

	if h.BankKeeper == nil {
		return errors.New("bank keeper cannot be nil")
	}

	if h.SupplyCapDenom == "" && !h.SupplyCapAmount.IsNil() {
		return errors.New("supply cap denom cannot be empty when an amount is configured")
	}

	if h.SupplyCapDenom != "" && (h.SupplyCapAmount.IsNil() || !h.SupplyCapAmount.IsPositive()) {
		return errors.New("supply cap amount must be positive when a denom is configured")
	}

	return nil
}

// NewPostHandler returns a new PostHandler decorators chain.
func NewPostHandler(ho HandlerOptions) sdk.PostHandler {
	postDecorators := []sdk.PostDecorator{
		NewBurnDecorator(ho.FeeCollectorName, ho.BankKeeper),
	}
	if ho.SupplyCapDenom != "" {
		postDecorators = append(
			postDecorators,
			NewSupplyCapDecorator(ho.BankKeeper, ho.SupplyCapDenom, ho.SupplyCapAmount),
		)
	}

	return sdk.ChainPostDecorators(postDecorators...)
}
