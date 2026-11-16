//go:build !lithovm_chain_lab

package app

import (
	"encoding/json"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"testing"
)

func TestOrdinaryBuildHasNoLithoVMStoreAndRejectsItsGenesis(t *testing.T) {
	keys, _, _ := StoreKeys()
	if keys["lithovm"] != nil {
		t.Fatal("ordinary build mounted native store")
	}
	if err := (&Evmos{}).importLithoVMGenesis(
		sdk.Context{}, map[string]json.RawMessage{"lithovm": []byte(`{"version":1,"entries":[]}`)},
	); err == nil {
		t.Fatal("ordinary build accepted native genesis")
	}
}
