package wal

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestReadOnlyNeverMutatesSegments(t *testing.T) {
	for _, format := range []LogFormat{Binary, JSON} {
		t.Run(segmentName(uint64(format)+1), func(t *testing.T) {
			dir := t.TempDir()
			writer, err := Open(dir, &Options{LogFormat: format, SegmentSize: 32})
			if err != nil {
				t.Fatal(err)
			}
			for i := uint64(1); i <= 12; i++ {
				if err = writer.Write(i, []byte("immutable-payload")); err != nil {
					t.Fatal(err)
				}
			}
			defer writer.Close()
			snapshot := func() map[string][]byte {
				m := map[string][]byte{}
				files, err := os.ReadDir(dir)
				if err != nil {
					t.Fatal(err)
				}
				for _, f := range files {
					b, err := os.ReadFile(filepath.Join(dir, f.Name()))
					if err != nil {
						t.Fatal(err)
					}
					m[f.Name()] = b
				}
				return m
			}
			before := snapshot()
			reader, err := Open(dir, &Options{LogFormat: format, ReadOnly: true})
			if err != nil {
				t.Fatal(err)
			}
			for i := uint64(1); i <= 12; i++ {
				b, err := reader.Read(i)
				if err != nil || !bytes.Equal(b, []byte("immutable-payload")) {
					t.Fatalf("read %d: %q %v", i, b, err)
				}
			}
			batch := Batch{}
			batch.Write(13, []byte("forbidden"))
			for _, err := range []error{reader.Write(13, []byte("forbidden")), reader.WriteBatch(&batch), reader.TruncateFront(2), reader.TruncateBack(11)} {
				if !errors.Is(err, os.ErrPermission) {
					t.Fatalf("mutation did not fail closed: %v", err)
				}
			}
			if err = reader.Close(); err != nil {
				t.Fatal(err)
			}
			after := snapshot()
			if len(before) != len(after) {
				t.Fatal("segment set changed")
			}
			for name, b := range before {
				if !bytes.Equal(b, after[name]) {
					t.Fatalf("modified %s", name)
				}
			}
			if err = writer.Write(13, []byte("writer-still-works")); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestReadOnlyDoesNotCreateOrRecoverSegments(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "missing")
	if _, err := Open(dir, &Options{ReadOnly: true}); !os.IsNotExist(err) {
		t.Fatalf("missing directory: %v", err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("reader created directory: %v", err)
	}
	for _, suffix := range []string{".START", ".END"} {
		t.Run(suffix, func(t *testing.T) {
			dir := t.TempDir()
			name := segmentName(1) + suffix
			path := filepath.Join(dir, name)
			b := appendBinaryEntryFixture([]byte("payload"))
			if err := os.WriteFile(path, b, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := Open(dir, &Options{ReadOnly: true}); !errors.Is(err, ErrCorrupt) {
				t.Fatalf("maintenance marker: %v", err)
			}
			actual, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(b, actual) {
				t.Fatalf("reader recovered writer maintenance: %v", err)
			}
		})
	}
}
func appendBinaryEntryFixture(b []byte) []byte { data, _ := appendBinaryEntry(nil, b); return data }
