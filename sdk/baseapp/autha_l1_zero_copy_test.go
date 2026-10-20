package baseapp

// Autha L1-R1 finding test (L1-03). The October query-closure fix closes a historical memiavl snapshot in
// the gRPC interceptor, before grpc-go serializes the handler's response (server.go processUnaryRPC calls
// sendResponse after the handler chain returns). With memiavl zero-copy enabled, a response value can
// still point into the unmapped snapshot. This test follows the vendor's TestIntegratedHistoricalQueryMappings
// with ZeroCopy=true and recovers the fault (debug.SetPanicOnFault) instead of crashing the process.
// It is expected to FAIL on the reviewed code; it passes once historical snapshots never use zero-copy.

import (
	"bytes"
	"context"
	"runtime/debug"
	"testing"

	"cosmossdk.io/log"
	storetypes "cosmossdk.io/store/types"
	abci "github.com/cometbft/cometbft/abci/types"
	dbm "github.com/cosmos/cosmos-db"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/gogoproto/proto"
	"github.com/crypto-org-chain/cronos/memiavl"
	cronos "github.com/crypto-org-chain/cronos/store/rootmulti"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

func TestAuthaL1HistoricalGRPCResponseOutlivesSnapshotWithZeroCopy(t *testing.T) {
	dir := t.TempDir()
	value := bytes.Repeat([]byte("historical-value-"), 4096) // 68 KiB, stored in the snapshot's mapped kv file
	db, err := memiavl.Load(dir, memiavl.Options{CreateIfMissing: true, InitialStores: []string{"test"}})
	require.NoError(t, err)
	require.NoError(t, db.ApplyChangeSets([]*memiavl.NamedChangeSet{{Name: "test", Changeset: memiavl.ChangeSet{Pairs: []*memiavl.KVPair{{Key: []byte("k"), Value: value}}}}}))
	_, err = db.Commit()
	require.NoError(t, err)
	require.NoError(t, db.RewriteSnapshot())
	require.NoError(t, db.Close())
	rs := cronos.NewStore(dir, log.NewNopLogger(), false, false)
	rs.SetMemIAVLOptions(memiavl.Options{ZeroCopy: true}) // node option memiavl.zero-copy = true
	key := storetypes.NewKVStoreKey("test")
	rs.MountStoreWithDB(key, storetypes.StoreTypeIAVL, nil)
	require.NoError(t, rs.LoadLatestVersion())
	defer rs.Close()
	rs.GetKVStore(key).Set([]byte("k"), []byte("current"))
	rs.Commit()
	app := NewBaseApp(t.Name(), log.NewNopLogger(), dbm.NewMemDB(), nil)
	_, err = app.FinalizeBlock(&abci.RequestFinalizeBlock{Height: 1})
	require.NoError(t, err)
	_, err = app.Commit()
	require.NoError(t, err)
	app.qms = rs
	read := func(ctx sdk.Context) *abci.ResponseQuery { return &abci.ResponseQuery{Value: ctx.KVStore(key).Get([]byte("k"))} }
	var server captureQueryServer
	desc := &grpc.ServiceDesc{ServiceName: "mapping.Test", Methods: []grpc.MethodDesc{{MethodName: "Read", Handler: func(_ interface{}, ctx context.Context, _ func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
		return interceptor(ctx, nil, &grpc.UnaryServerInfo{}, func(ctx context.Context, _ interface{}) (interface{}, error) { return read(sdk.UnwrapSDKContext(ctx)), nil })
	}}}}
	app.GRPCQueryRouter().serviceData = []serviceData{{serviceDesc: desc}}
	app.RegisterGRPCServer(&server)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-cosmos-block-height", "1"))
	v, err := server.desc.Methods[0].Handler(nil, ctx, nil, nil)
	require.NoError(t, err)
	response := v.(*abci.ResponseQuery)
	// grpc-go serializes here, after the interceptor (and its deferred snapshot close) has returned.
	var wire []byte
	fault := func() (f interface{}) {
		defer debug.SetPanicOnFault(debug.SetPanicOnFault(true))
		defer func() { f = recover() }()
		wire, err = proto.Marshal(response)
		return nil
	}()
	require.Nil(t, fault, "historical gRPC response referenced unmapped snapshot memory during serialization")
	require.NoError(t, err)
	decoded := &abci.ResponseQuery{}
	require.NoError(t, proto.Unmarshal(wire, decoded))
	require.Equal(t, value, decoded.Value, "historical gRPC response changed after the snapshot was closed")
}
