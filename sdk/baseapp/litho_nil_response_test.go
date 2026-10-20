package baseapp_test

import (
	"cosmossdk.io/log"
	storetypes "cosmossdk.io/store/types"
	abci "github.com/cometbft/cometbft/abci/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/baseapp"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestLITHOFinalizeBlockErrorSkipsStreamingListener(t *testing.T) {
	app := baseapp.NewBaseApp(t.Name(), log.NewNopLogger(), dbm.NewMemDB(), nil)
	listener := NewMockABCIListener("nil-response-regression")
	app.SetStreamingManager(storetypes.StreamingManager{ABCIListeners: []storetypes.ABCIListener{&listener}})
	_, err := app.InitChain(&abci.RequestInitChain{InitialHeight: 3})
	require.NoError(t, err)
	require.NotPanics(t, func() {
		res, err := app.FinalizeBlock(&abci.RequestFinalizeBlock{Height: 4})
		require.Nil(t, res)
		require.ErrorContains(t, err, "invalid height")
	})
}
