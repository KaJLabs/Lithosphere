package wal

// Autha L1-R1: read-only WAL guards that the candidate's tests do not cover (mutants W6 and W7).

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// A reader must never create the first segment of an existing, empty log directory.
func TestAuthaL1ReadOnlyOpenOfEmptyDirectoryCreatesNothing(t *testing.T) {
	dir := t.TempDir()
	if _, err := Open(dir, &Options{ReadOnly: true}); !os.IsNotExist(err) {
		t.Fatalf("empty directory: %v", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("reader created %d entries (%v)", len(entries), err)
	}
}

// A reader must hold the last segment open read-only (checked through /proc/self/fdinfo, since the
// process may run as root and ignore file permissions).
func TestAuthaL1ReadOnlyOpenUsesReadOnlyDescriptor(t *testing.T) {
	dir := t.TempDir()
	w, err := Open(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = w.Write(1, []byte("entry")); err != nil {
		t.Fatal(err)
	}
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	r, err := Open(dir, &Options{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	fds, _ := os.ReadDir("/proc/self/fd")
	found := 0
	for _, fd := range fds {
		target, err := os.Readlink(filepath.Join("/proc/self/fd", fd.Name()))
		if err != nil || !strings.HasPrefix(target, dir+string(os.PathSeparator)) {
			continue
		}
		info, err := os.ReadFile(filepath.Join("/proc/self/fdinfo", fd.Name()))
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(info), "\n") {
			if strings.HasPrefix(line, "flags:") {
				flags, _ := strconv.ParseInt(strings.TrimSpace(strings.TrimPrefix(line, "flags:")), 8, 64)
				found++
				if int(flags&3) != os.O_RDONLY {
					t.Fatalf("reader holds %s with access mode %o", target, flags&3)
				}
			}
		}
	}
	if found == 0 {
		t.Fatal("no open segment found for the reader")
	}
}
