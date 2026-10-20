package memiavl

// Autha L1-R1: lifecycle guards from the October storage fix that the candidate's tests do not cover
// (mutants M4, M6, M7, M8). The vendor's failure-path test uses an empty tree, whose snapshot has nothing
// mapped, so leaks of the tree or the WAL on a failed read-only load were not observable.

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func authaDB(t *testing.T) string {
	dir := t.TempDir()
	db, err := Load(dir, Options{CreateIfMissing: true, InitialStores: []string{"test"}, AsyncCommitBuffer: -1})
	if err != nil {
		t.Fatal(err)
	}
	put := func(v string) {
		if err := db.ApplyChangeSets([]*NamedChangeSet{{Name: "test", Changeset: ChangeSet{Pairs: []*KVPair{{Key: []byte("k" + v), Value: bytes.Repeat([]byte(v), 70000)}}}}}); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	put("1")
	if err := db.RewriteSnapshot(); err != nil { // snapshot with mapped data at version 1
		t.Fatal(err)
	}
	put("2")
	put("3") // WAL entries beyond the snapshot
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	return dir
}

func authaCount(t *testing.T, dir string) (fds, maps int) {
	entries, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if target, err := os.Readlink(filepath.Join("/proc/self/fd", e.Name())); err == nil && strings.HasPrefix(target, dir) {
			fds++
		}
	}
	m, err := os.ReadFile("/proc/self/maps")
	if err != nil {
		t.Fatal(err)
	}
	return fds, strings.Count(string(m), dir)
}

// A read-only load that fails after opening the snapshot and the WAL must release both.
func TestAuthaL1FailedReadOnlyLoadReleasesMappedSnapshotAndWAL(t *testing.T) {
	dir := authaDB(t)
	fds0, maps0 := authaCount(t, dir)
	for i := 0; i < 50; i++ {
		reader, err := Load(dir, Options{ReadOnly: true, TargetVersion: 10}) // in the future: CatchupWAL fails
		if err == nil {
			reader.Close()
			t.Fatal("load of a future version succeeded")
		}
	}
	fds1, maps1 := authaCount(t, dir)
	if fds1 != fds0 || maps1 != maps0 {
		t.Fatalf("failed read-only loads leaked: fds %d -> %d, mappings %d -> %d", fds0, fds1, maps0, maps1)
	}
}

// GetLatestVersion must not repair (truncate) a WAL whose tail is incomplete.
func TestAuthaL1LatestVersionNeverRepairsWAL(t *testing.T) {
	dir := authaDB(t)
	files, _ := filepath.Glob(filepath.Join(dir, "wal", "*"))
	if len(files) == 0 {
		t.Fatal("no WAL segment")
	}
	last := files[len(files)-1]
	f, err := os.OpenFile(last, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Write([]byte{0x80}); err != nil {
		t.Fatal(err)
	}
	f.Close()
	before, _ := os.ReadFile(last)
	_, _ = GetLatestVersion(dir)
	after, _ := os.ReadFile(last)
	if !bytes.Equal(before, after) {
		t.Fatal("GetLatestVersion modified the WAL")
	}
}

// A writer load that fails after taking the directory lock must release the lock.
func TestAuthaL1FailedWriterLoadReleasesLock(t *testing.T) {
	dir := t.TempDir() // exists, but holds no database
	if _, err := Load(dir, Options{}); err == nil {
		t.Fatal("load of an empty directory succeeded")
	}
	lock, err := LockFile(filepath.Join(dir, LockFileName))
	if err != nil {
		t.Fatalf("lock still held after failed load: %v", err)
	}
	_ = lock.Unlock()
	_ = lock.Destroy()
}
