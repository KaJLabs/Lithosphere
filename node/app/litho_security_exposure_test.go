package app

import (
	"cosmossdk.io/log"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/baseapp"
	"testing"
)

type lithoSecurityOptions map[string]interface{}

func (o lithoSecurityOptions) Get(key string) interface{} { return o[key] }

// These advisories concern x/crisis transactions. Importing its legacy CLI flag
// must never accidentally enable its state machine or Msg service in LITHO.
func TestLITHOCrisisModuleUnavailable(t *testing.T) {
	home := t.TempDir()
	node := NewEvmos(log.NewNopLogger(), dbm.NewMemDB(), nil, true, map[int64]bool{}, home, 0,
		lithoSecurityOptions{"home": home}, baseapp.SetChainID("lithosphere_9005-1"))
	defer node.Close()
	if _, exists := node.mm.Modules["crisis"]; exists {
		t.Fatal("crisis state machine is registered")
	}
	if _, exists := node.BasicModuleManager["crisis"]; exists {
		t.Fatal("crisis basic module is registered")
	}
	if _, exists := node.DefaultGenesis()["crisis"]; exists {
		t.Fatal("crisis genesis is exposed")
	}
}
