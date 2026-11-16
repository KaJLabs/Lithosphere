//go:build !lithovm_chain_lab

package keeper

import "testing"

func TestLithoVMCandidateNotRegisteredByDefault(t *testing.T) {
	if hook := (&Keeper{}).lithovmCandidateHook(nil, nil, false); hook != nil {
		t.Fatal("ordinary build installed native gateway hook")
	}
}
