//go:build lithovm_chain_lab

package app

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/testutil"
	"github.com/ethereum/go-ethereum/crypto"
)

func TestLithoVMLabStoreGenesisIsMountedAndEmptyRoundTrips(t *testing.T) {
	keys, _, _ := StoreKeys()
	key := keys["lithovm"]
	if key == nil || key == keys["evm"] {
		t.Fatal("lab native store missing or aliased to EVM")
	}
	ctx := testutil.DefaultContext(key, storetypes.NewTransientStoreKey("native-genesis-t"))
	app := &Evmos{keys: keys}
	state := make(map[string]json.RawMessage)
	if err := app.exportLithoVMGenesis(ctx, state); err != nil || len(state["lithovm"]) == 0 {
		t.Fatalf("empty export: %v", err)
	}
	if err := app.importLithoVMGenesis(ctx, state); err != nil {
		t.Fatalf("empty import: %v", err)
	}
	if err := app.importLithoVMGenesis(ctx, map[string]json.RawMessage{"lithovm": []byte(`{"version":2,"entries":[]}`)}); err == nil {
		t.Fatal("unsupported native genesis version was accepted")
	}
}

func TestLithoVMLabStoreNonemptyExportImport(t *testing.T) {
	keys, _, _ := StoreKeys()
	ctx := testutil.DefaultContext(keys["lithovm"], storetypes.NewTransientStoreKey("native-export-t"))
	app := &Evmos{keys: keys}
	address := strings.Repeat("a", 40)
	contractKey := []byte("lithovm/v1/contracts/" + address)
	mapKey := []byte("lithovm/v2/maps/" + address + "/balances/" + strings.Repeat("0", 64))
	storage := []byte(`{"version":1,"words":{},"strings":{},"maps":[]}`)
	code := []byte{0}
	record := []byte(fmt.Sprintf(`{"version":2,"bytecode":"0x%s","code_hash":"%s","storage":"0x%s"}`,
		hex.EncodeToString(code), strings.ToLower(crypto.Keccak256Hash(code).Hex()), hex.EncodeToString(storage)))
	word := make([]byte, 32)
	word[31] = 7
	ctx.KVStore(keys["lithovm"]).Set(contractKey, record)
	ctx.KVStore(keys["lithovm"]).Set(mapKey, word)
	if err := app.importLithoVMGenesis(ctx, map[string]json.RawMessage{}); err == nil {
		t.Fatal("nonempty native store accepted missing genesis section")
	}
	state := make(map[string]json.RawMessage)
	if err := app.exportLithoVMGenesis(ctx, state); err != nil {
		t.Fatal(err)
	}
	freshKey := storetypes.NewKVStoreKey("lithovm")
	freshCtx := testutil.DefaultContext(freshKey, storetypes.NewTransientStoreKey("native-import-t"))
	fresh := &Evmos{keys: map[string]*storetypes.KVStoreKey{"lithovm": freshKey}}
	if err := fresh.importLithoVMGenesis(freshCtx, state); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(freshCtx.KVStore(freshKey).Get(contractKey), record) ||
		!bytes.Equal(freshCtx.KVStore(freshKey).Get(mapKey), word) {
		t.Fatal("native state changed during app export/import")
	}
}
