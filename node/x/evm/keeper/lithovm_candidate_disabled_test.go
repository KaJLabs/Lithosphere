//go:build !lithovm_chain_lab

package keeper

import (
	"testing"

	sdk "github.com/cosmos/cosmos-sdk/types"
)

func TestLithoVMCandidateNotRegisteredByDefault(t *testing.T) {
	if hook := (&Keeper{}).lithovmCandidateHook(nil, nil, false); hook != nil {
		t.Fatal("ordinary build installed native gateway hook")
	}
}

func TestOrdinaryBuildActivationGateIsAlwaysInactive(t *testing.T) {
	k := &Keeper{}
	k.SetLithoVMActivation(func(sdk.Context) bool { return true })
	if k.lithovmActive(sdk.Context{}) {
		t.Fatal("ordinary build activated the native gateway")
	}
}
