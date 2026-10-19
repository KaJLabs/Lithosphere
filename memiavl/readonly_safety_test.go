package memiavl

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

// This is a storage correctness fixture, with no node, network or signing keys.
// Keep a writer descriptor at its actual offset while a historical reader opens
// a database containing a partially persisted next record.
func TestHistoricalReaderCannotTruncateConcurrentWriter(t *testing.T) {
	dir := t.TempDir()
	db, err := Load(dir, Options{CreateIfMissing: true, InitialStores: []string{"test"}, AsyncCommitBuffer: -1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Commit(); err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	files, err := filepath.Glob(filepath.Join(dir, "wal", "*"))
	if err != nil || len(files) != 1 {
		t.Fatalf("wal files: %v, %v", files, err)
	}
	path := files[0]
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	writer, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	if _, err = writer.Seek(0, 2); err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte{0x41}, 10831)
	prefix := make([]byte, 10)
	n := binary.PutUvarint(prefix, uint64(len(payload)))
	record := append(prefix[:n], payload...)
	split := 256
	if _, err = writer.Write(record[:split]); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	reader, loadErr := Load(dir, Options{ReadOnly: true, TargetVersion: 1})
	if reader != nil {
		if err = reader.Close(); err != nil {
			t.Fatal(err)
		}
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Errorf("historical read changed writer WAL: %d -> %d bytes (load error: %v)", len(before), len(after), loadErr)
	}
	if _, err = writer.Write(record[split:]); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	expected := append(original, record...)
	if !bytes.Equal(expected, actual) {
		t.Errorf("reader destroyed concurrently persisted record: expected %d bytes, got %d; zero prefix=%v", len(expected), len(actual), bytes.Equal(actual[len(original):len(original)+split], make([]byte, split)))
	}
}

func TestLatestVersionClosesItsWAL(t *testing.T) {
	dir := t.TempDir()
	db, err := Load(dir, Options{CreateIfMissing: true, InitialStores: []string{"test"}, AsyncCommitBuffer: -1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Commit(); err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	count := func() int {
		files, err := os.ReadDir("/proc/self/fd")
		if err != nil {
			t.Fatal(err)
		}
		return len(files)
	}
	before := count()
	for i := 0; i < 100; i++ {
		version, err := GetLatestVersion(dir)
		if err != nil || version != 1 {
			t.Fatalf("version=%d err=%v", version, err)
		}
	}
	after := count()
	if after != before {
		t.Fatalf("latest-version reader leaked descriptors: %d -> %d", before, after)
	}
}

func TestFailedReadOnlyLoadsReleaseSnapshotAndWAL(t *testing.T) {
	dir := t.TempDir()
	db, err := Load(dir, Options{CreateIfMissing: true, InitialStores: []string{"test"}, AsyncCommitBuffer: -1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Commit(); err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	files, _ := filepath.Glob(filepath.Join(dir, "wal", "*"))
	if len(files) != 1 {
		t.Fatal(files)
	}
	file, err := os.OpenFile(files[0], os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = file.Write([]byte{0x80}); err != nil {
		t.Fatal(err)
	}
	file.Close()
	before, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatal(err)
	}
	count := func() int {
		entries, err := os.ReadDir("/proc/self/fd")
		if err != nil {
			t.Fatal(err)
		}
		return len(entries)
	}
	fdBefore := count()
	mapsBefore, err := os.ReadFile("/proc/self/maps")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 100; i++ {
		reader, err := Load(dir, Options{ReadOnly: true, TargetVersion: 1})
		if err == nil {
			reader.Close()
			t.Fatal("incomplete WAL accepted instead of failing closed")
		}
	}
	after, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("failed reader changed WAL")
	}
	if count() != fdBefore {
		t.Fatalf("failed reader leaked fd: %d -> %d", fdBefore, count())
	}
	mapsAfter, err := os.ReadFile("/proc/self/maps")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Count(mapsBefore, []byte(dir)) != bytes.Count(mapsAfter, []byte(dir)) {
		t.Fatal("failed reader leaked snapshot mappings")
	}
}
