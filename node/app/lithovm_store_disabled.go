//go:build !lithovm_chain_lab

package app

import (
	"encoding/json"
	"errors"

	sdk "github.com/cosmos/cosmos-sdk/types"
)

func lithovmLabStoreKeys() []string { return nil }

func (*Evmos) importLithoVMGenesis(_ sdk.Context, state map[string]json.RawMessage) error {
	if _, present := state["lithovm"]; present {
		return errors.New("native genesis requires the disabled lab build")
	}
	return nil
}

func (*Evmos) exportLithoVMGenesis(_ sdk.Context, _ map[string]json.RawMessage) error {
	return nil
}
