//go:build lithovm_chain_lab

package app

import (
	"testing"

	"cosmossdk.io/log"
	"cosmossdk.io/store/metrics"
	"cosmossdk.io/store/rootmulti"
	storetypes "cosmossdk.io/store/types"
	upgradetypes "cosmossdk.io/x/upgrade/types"
	"github.com/cosmos/cosmos-sdk/baseapp"
	dbm "github.com/cosmos/cosmos-db"
)

func TestLithoVMStoreUpgradeIsHeightAndPlanGated(t *testing.T) {
	db := dbm.NewMemDB()
	open := func(withNative bool) (storetypes.CommitMultiStore, *storetypes.KVStoreKey, *storetypes.KVStoreKey) {
		ms := rootmulti.NewStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
		evm := storetypes.NewKVStoreKey("evm")
		ms.MountStoreWithDB(evm, storetypes.StoreTypeIAVL, nil)
		var native *storetypes.KVStoreKey
		if withNative {
			native = storetypes.NewKVStoreKey("lithovm")
			ms.MountStoreWithDB(native, storetypes.StoreTypeIAVL, nil)
		}
		return ms, evm, native
	}

	old, evm, _ := open(false)
	if err := old.LoadLatestVersion(); err != nil {
		t.Fatal(err)
	}
	old.GetKVStore(evm).Set([]byte("existing"), []byte("evm-state"))
	if version := old.Commit().Version; version != 1 {
		t.Fatalf("old state version = %d", version)
	}

	for _, plan := range []upgradetypes.Plan{
		{Name: "unrelated-upgrade", Height: 2},
		{Name: lithovmStoreLabUpgradeName, Height: 0},
	} {
		if _, ok := nativeStoreLoaderForPlan(plan); ok {
			t.Fatalf("accepted unrelated or unplanned upgrade: %+v", plan)
		}
	}
	if loader, ok := nativeStoreLoaderForPlan(upgradetypes.Plan{Name: lithovmStoreLabUpgradeName, Height: 3}); !ok {
		t.Fatal("missing test loader")
	} else {
		wrongHeight, _, _ := open(true)
		if err := loader(wrongHeight); err == nil {
			t.Fatal("wrong-height loader accepted a missing native store")
		}
	}
	withoutPlan, _, _ := open(true)
	if err := baseapp.DefaultStoreLoader(withoutPlan); err == nil {
		t.Fatal("new store loaded without a scheduled upgrade")
	}

	loader, ok := nativeStoreLoaderForPlan(upgradetypes.Plan{Name: lithovmStoreLabUpgradeName, Height: 2})
	if !ok {
		t.Fatal("planned loader missing")
	}
	upgraded, upgradedEVM, native := open(true)
	if err := loader(upgraded); err != nil {
		t.Fatal(err)
	}
	if got := string(upgraded.GetKVStore(upgradedEVM).Get([]byte("existing"))); got != "evm-state" {
		t.Fatalf("existing EVM state changed: %q", got)
	}
	if got := upgraded.GetKVStore(native).Get([]byte("native")); got != nil {
		t.Fatalf("new native store was not empty: %x", got)
	}
	upgraded.GetKVStore(native).Set([]byte("native"), []byte("isolated"))
	if version := upgraded.Commit().Version; version != 2 {
		t.Fatalf("upgraded state version = %d", version)
	}

	reopened, reopenedEVM, reopenedNative := open(true)
	if err := reopened.LoadLatestVersion(); err != nil {
		t.Fatal(err)
	}
	if got := string(reopened.GetKVStore(reopenedEVM).Get([]byte("existing"))); got != "evm-state" {
		t.Fatalf("reopened EVM state changed: %q", got)
	}
	if got := string(reopened.GetKVStore(reopenedNative).Get([]byte("native"))); got != "isolated" {
		t.Fatalf("reopened native state changed: %q", got)
	}
	legacy, _, _ := open(false)
	if err := legacy.LoadLatestVersion(); err == nil {
		// The old binary can ignore the added store. Operational cutover must
		// prevent mixed-version restart; the store loader cannot enforce it.
		t.Log("legacy store set reopened post-upgrade DB without native state")
	}
}
