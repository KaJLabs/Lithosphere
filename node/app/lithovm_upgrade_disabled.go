//go:build !lithovm_chain_lab

package app

import upgradetypes "cosmossdk.io/x/upgrade/types"

func (*Evmos) registerLithoVMStoreUpgrade() {}

func (*Evmos) configureLithoVMStoreLoader(_ upgradetypes.Plan) {}
