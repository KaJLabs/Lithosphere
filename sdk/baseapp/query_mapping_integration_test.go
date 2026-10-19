package baseapp
import (
 "context"
 "os"
 "strings"
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
func TestIntegratedHistoricalQueryMappings(t *testing.T){
 for _,transport:=range []string{"abci","grpc"}{t.Run(transport,func(t *testing.T){
 dir:=t.TempDir()
 db,err:=memiavl.Load(dir,memiavl.Options{CreateIfMissing:true,InitialStores:[]string{"test"},ZeroCopy:false});require.NoError(t,err)
 require.NoError(t,db.ApplyChangeSets([]*memiavl.NamedChangeSet{{Name:"test",Changeset:memiavl.ChangeSet{Pairs:[]*memiavl.KVPair{{Key:[]byte("k"),Value:[]byte("historical")}}}}}))
 _,err=db.Commit();require.NoError(t,err);require.NoError(t,db.RewriteSnapshot());require.NoError(t,db.Close())
 rs:=cronos.NewStore(dir,log.NewNopLogger(),false,false)
 rs.SetMemIAVLOptions(memiavl.Options{ZeroCopy:false})
 key:=storetypes.NewKVStoreKey("test");rs.MountStoreWithDB(key,storetypes.StoreTypeIAVL,nil);require.NoError(t,rs.LoadLatestVersion());defer rs.Close()
 rs.GetKVStore(key).Set([]byte("k"),[]byte("current"));rs.Commit()
 app:=NewBaseApp(t.Name(),log.NewNopLogger(),dbm.NewMemDB(),nil)
 _,err=app.FinalizeBlock(&abci.RequestFinalizeBlock{Height:1});require.NoError(t,err);_,err=app.Commit();require.NoError(t,err);app.qms=rs
 count:=func()int{b,e:=os.ReadFile("/proc/self/maps");require.NoError(t,e);n:=0;for _,l:=range strings.Split(string(b),"\n"){if strings.Contains(l,dir){n++}};return n}
 before:=count()
 read:=func(ctx sdk.Context)*abci.ResponseQuery{return &abci.ResponseQuery{Value:ctx.KVStore(key).Get([]byte("k"))}}
 var server captureQueryServer
 if transport=="grpc"{
 desc:=&grpc.ServiceDesc{ServiceName:"mapping.Test",Methods:[]grpc.MethodDesc{{MethodName:"Read",Handler:func(_ interface{},ctx context.Context,_ func(interface{})error,interceptor grpc.UnaryServerInterceptor)(interface{},error){return interceptor(ctx,nil,&grpc.UnaryServerInfo{},func(ctx context.Context,_ interface{})(interface{},error){return read(sdk.UnwrapSDKContext(ctx)),nil})}}}}
 app.GRPCQueryRouter().serviceData=[]serviceData{{serviceDesc:desc}};app.RegisterGRPCServer(&server)
 }
 for i:=0;i<50;i++{
 var response *abci.ResponseQuery
 if transport=="abci"{response=app.handleQueryGRPC(func(ctx sdk.Context,_ *abci.RequestQuery)(*abci.ResponseQuery,error){return read(ctx),nil},&abci.RequestQuery{Height:1})}else{
 ctx:=metadata.NewIncomingContext(context.Background(),metadata.Pairs("x-cosmos-block-height","1"))
 v,e:=server.desc.Methods[0].Handler(nil,ctx,nil,nil);require.NoError(t,e);response=v.(*abci.ResponseQuery)
 }
 // Serialize only AFTER handler cleanup/unmapping; catches response-lifetime errors
 // for this Get-based response under the explicitly selected ZeroCopy=false policy.
 wire,e:=proto.Marshal(response);require.NoError(t,e);decoded:=&abci.ResponseQuery{};require.NoError(t,proto.Unmarshal(wire,decoded));require.Equal(t,[]byte("historical"),decoded.Value)
 require.Equal(t,before,count(),"request retained snapshot mappings")
 }
 require.Equal(t,[]byte("current"),rs.GetKVStore(key).Get([]byte("k")))
 t.Logf("%s: 50 historical requests, mappings baseline=%d final=%d, post-handler serialization passed",transport,before,count())
 })}
}
