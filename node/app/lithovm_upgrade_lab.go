//go:build lithovm_chain_lab

package app

import (
	"context"

	storetypes "cosmossdk.io/store/types"
	upgradetypes "cosmossdk.io/x/upgrade/types"
	"github.com/cosmos/cosmos-sdk/baseapp"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/cosmos-sdk/types/module"
)

// LITHO mainnet 9005 plan name (Makalu used the lab name lithovm-native-store-lab-v1).
const lithovmStoreLabUpgradeName = "lithovm-native-store-v1"

func nativeStoreLoaderForPlan(plan upgradetypes.Plan) (baseapp.StoreLoader, bool) {
	if plan.Name != lithovmStoreLabUpgradeName || plan.Height <= 0 {
		return nil, false
	}
	return upgradetypes.UpgradeStoreLoader(plan.Height, &storetypes.StoreUpgrades{
		Added: []string{"lithovm"},
	}), true
}

func (app *Evmos) registerLithoVMStoreUpgrade() {
	// LMX-C3: the gateway becomes active only from the block in which this upgrade was applied.
	// The lookup uses its own gas meter so it never changes gas accounting of any transaction;
	// before activation the new binary therefore executes exactly as rc3.
	app.EvmKeeper.SetLithoVMActivation(func(ctx sdk.Context) bool {
		done, err := app.UpgradeKeeper.GetDoneHeight(ctx.WithGasMeter(storetypes.NewInfiniteGasMeter()), lithovmStoreLabUpgradeName)
		return err == nil && done > 0 && ctx.BlockHeight() >= done
	})
	app.UpgradeKeeper.SetUpgradeHandler(lithovmStoreLabUpgradeName,
		func(ctx context.Context, _ upgradetypes.Plan, versions module.VersionMap) (module.VersionMap, error) {
			return app.mm.RunMigrations(ctx, app.configurator, versions)
		})
}

func (app *Evmos) configureLithoVMStoreLoader(plan upgradetypes.Plan) {
	if loader, ok := nativeStoreLoaderForPlan(plan); ok {
		app.SetStoreLoader(loader)
	}
}
