package app

// Autha L1-R1: x/crisis is linked (legacy CLI flag) but must not be reachable as a transaction. The
// candidate's TestLITHOCrisisModuleUnavailable checks the module managers and genesis; this also checks
// that the crisis messages cannot be decoded (interface registry) or routed (message service router).

import (
	"testing"

	"cosmossdk.io/log"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/baseapp"
)

func TestAuthaL1CrisisMessagesNotDecodableOrRoutable(t *testing.T) {
	home := t.TempDir()
	node := NewEvmos(log.NewNopLogger(), dbm.NewMemDB(), nil, true, map[int64]bool{}, home, 0,
		lithoSecurityOptions{"home": home}, baseapp.SetChainID("lithosphere_9005-1"))
	defer node.Close()
	for _, url := range []string{"/cosmos.crisis.v1beta1.MsgVerifyInvariant", "/cosmos.crisis.v1beta1.MsgUpdateParams"} {
		if h := node.MsgServiceRouter().HandlerByTypeURL(url); h != nil {
			t.Fatalf("%s has a message handler", url)
		}
		if _, err := node.InterfaceRegistry().Resolve(url); err == nil {
			t.Fatalf("%s resolves in the interface registry, so a transaction carrying it decodes", url)
		}
	}
}
