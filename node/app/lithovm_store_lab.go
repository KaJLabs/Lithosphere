//go:build lithovm_chain_lab

package app

import (
	"encoding/json"
	"errors"

	sdk "github.com/cosmos/cosmos-sdk/types"
	nativechain "lithic.local/native-chain-lab"
)

// Only the disabled lab build mounts this fresh native store. Existing chains
// require a separately reviewed store upgrade before any such mount.
func lithovmLabStoreKeys() []string { return []string{"lithovm"} }

func (app *Evmos) importLithoVMGenesis(ctx sdk.Context, state map[string]json.RawMessage) error {
	key := app.keys["lithovm"]
	if key == nil {
		return errors.New("native store was not mounted")
	}
	data, present := state["lithovm"]
	if !present {
		iterator := ctx.KVStore(key).Iterator(nil, nil)
		notEmpty := iterator.Valid()
		iterator.Close()
		if notEmpty {
			return errors.New("native genesis section missing for nonempty store")
		}
		return nil // Fresh lab genesis starts with an empty native store.
	}
	return nativechain.ImportNativeGenesis(ctx.KVStore(key), data)
}

func (app *Evmos) exportLithoVMGenesis(ctx sdk.Context, state map[string]json.RawMessage) error {
	key := app.keys["lithovm"]
	if key == nil {
		return errors.New("native store was not mounted")
	}
	data, err := nativechain.ExportNativeGenesis(ctx.KVStore(key))
	if err != nil {
		return err
	}
	state["lithovm"] = data
	return nil
}
