package baseapp

import (
	"context"
	"cosmossdk.io/log"
	storetypes "cosmossdk.io/store/types"
	"errors"
	abci "github.com/cometbft/cometbft/abci/types"
	dbm "github.com/cosmos/cosmos-db"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"testing"
)

type trackedQueryStore struct {
	storetypes.MultiStore
	cache *trackedQueryCache
}

func (s trackedQueryStore) LatestVersion() int64 { return 2 }
func (s trackedQueryStore) CacheMultiStoreWithVersion(int64) (storetypes.CacheMultiStore, error) {
	return s.cache, nil
}

type cacheInterface = storetypes.CacheMultiStore
type trackedQueryCache struct {
	cacheInterface
	closes int
}

func (c *trackedQueryCache) Close() error { c.closes++; return nil }

type captureQueryServer struct{ desc *grpc.ServiceDesc }

func (s *captureQueryServer) RegisterService(d *grpc.ServiceDesc, _ interface{}) { s.desc = d }
func TestQueryRequestClosesOwnedCache(t *testing.T) {
	for _, transport := range []string{"abci", "grpc"} {
		for _, outcome := range []string{"success", "error", "panic"} {
			t.Run(transport+"/"+outcome, func(t *testing.T) {
				app := NewBaseApp(t.Name(), log.NewNopLogger(), dbm.NewMemDB(), nil)
				_, err := app.FinalizeBlock(&abci.RequestFinalizeBlock{Height: 1})
				require.NoError(t, err)
				_, err = app.Commit()
				require.NoError(t, err)
				cache := &trackedQueryCache{}
				app.qms = trackedQueryStore{cache: cache}
				called := false
				handle := func() {
					called = true
					require.Equal(t, 0, cache.closes, "cache closed before handler finished")
					if outcome == "panic" {
						panic("expected handler panic")
					}
				}
				if transport == "abci" {
					invoke := func() {
						app.handleQueryGRPC(func(_ sdk.Context, _ *abci.RequestQuery) (*abci.ResponseQuery, error) {
							handle()
							if outcome == "error" {
								return nil, errors.New("expected handler error")
							}
							return &abci.ResponseQuery{}, nil
						}, &abci.RequestQuery{Height: 1})
					}
					if outcome == "panic" {
						require.Panics(t, invoke)
					} else {
						invoke()
					}
				} else {
					desc := &grpc.ServiceDesc{ServiceName: "closure.Test", Methods: []grpc.MethodDesc{{MethodName: "Read", Handler: func(_ interface{}, ctx context.Context, _ func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
						return interceptor(ctx, nil, &grpc.UnaryServerInfo{}, func(context.Context, interface{}) (interface{}, error) {
							handle()
							if outcome == "error" {
								return nil, errors.New("expected handler error")
							}
							return nil, nil
						})
					}}}}
					app.GRPCQueryRouter().serviceData = []serviceData{{serviceDesc: desc}}
					server := &captureQueryServer{}
					app.RegisterGRPCServer(server)
					ctx := metadata.NewIncomingContext(context.Background(), metadata.MD{})
					_, err := server.desc.Methods[0].Handler(nil, ctx, nil, nil)
					if outcome != "success" {
						require.Error(t, err)
					}
				}
				require.True(t, called)
				require.Equal(t, 1, cache.closes, "request must close its owned query cache exactly once")
			})
		}
	}
}
