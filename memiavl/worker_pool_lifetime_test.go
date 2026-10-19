package memiavl

import (
 "runtime"
 "strings"
 "testing"
 "time"
)

func snapshotPoolGoroutines() int {
 buf := make([]byte, 8<<20)
 n := runtime.Stack(buf, true)
 return strings.Count(string(buf[:n]), "github.com/alitto/pond.(*WorkerPool).purge(")
}

// Exercise the exact historical-reader Load/Close path, without a node or txs.
func TestHistoricalReadersReleaseSnapshotWorkerPools(t *testing.T) {
 dir := t.TempDir()
 writer, err := Load(dir, Options{CreateIfMissing:true, InitialStores:[]string{"test"}, AsyncCommitBuffer:-1})
 if err != nil {t.Fatal(err)}
 defer writer.Close()
 if _,err=writer.Commit();err!=nil {t.Fatal(err)}
 time.Sleep(20*time.Millisecond)
 before:=snapshotPoolGoroutines()
 for i:=0;i<100;i++ {
  reader,err:=Load(dir,Options{ReadOnly:true,TargetVersion:1})
  if err!=nil {t.Fatal(err)}
  if reader.Version()!=1 {t.Fatal("historical version changed")}
  if err=reader.Close();err!=nil {t.Fatal(err)}
 }
 deadline:=time.Now().Add(time.Second)
 for time.Now().Before(deadline) && snapshotPoolGoroutines()>before {runtime.Gosched();time.Sleep(time.Millisecond)}
 after:=snapshotPoolGoroutines()
 if after>before {t.Fatalf("closed historical readers leaked snapshot worker pools: %d -> %d",before,after)}
}

func TestClosedWritersReleaseSnapshotWorkerPools(t *testing.T) {
 before:=snapshotPoolGoroutines()
 for i:=0;i<10;i++ {
  db,err:=Load(t.TempDir(),Options{CreateIfMissing:true,InitialStores:[]string{"test"},AsyncCommitBuffer:-1})
  if err!=nil {t.Fatal(err)}
  if _,err=db.Commit();err!=nil {t.Fatal(err)}
  if err=db.Close();err!=nil {t.Fatal(err)}
 }
 deadline:=time.Now().Add(time.Second)
 for time.Now().Before(deadline) && snapshotPoolGoroutines()>before {runtime.Gosched();time.Sleep(time.Millisecond)}
 after:=snapshotPoolGoroutines()
 if after>before {t.Fatalf("closed writers leaked snapshot worker pools: %d -> %d",before,after)}
}
