package armor

import (
	"bytes"
	"io"
	"strings"
	"testing"

	legacy "golang.org/x/crypto/openpgp/armor"
)

// Existing off-chain key files must remain readable after the library migration.
// The deprecated library is imported only by this compatibility test.
func TestLITHOLegacyArmorCompatibility(t *testing.T) {
	for _, size := range []int{0, 1, 3, 63, 64, 65, 1024} {
		data := bytes.Repeat([]byte{0, 1, 127, 255}, size)
		headers := map[string]string{"version": "0.0.0", "type": "secp256k1"}
		var old bytes.Buffer
		writer, err := legacy.Encode(&old, "TENDERMINT PRIVATE KEY", headers)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = writer.Write(data); err != nil {
			t.Fatal(err)
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		kind, gotHeaders, got, err := DecodeArmor(old.String())
		if err != nil || kind != "TENDERMINT PRIVATE KEY" || !bytes.Equal(got, data) || gotHeaders["type"] != headers["type"] {
			t.Fatalf("legacy decode failed: kind=%q err=%v", kind, err)
		}
		newEncoding := EncodeArmor(kind, headers, data)
		decoded, err := legacy.Decode(strings.NewReader(newEncoding))
		if err != nil {
			t.Fatal(err)
		}
		oldDecoded, err := io.ReadAll(decoded.Body)
		if err != nil || !bytes.Equal(oldDecoded, data) {
			t.Fatalf("legacy reader rejected new output: %v", err)
		}
	}
}

func TestLITHORejectsCorruptLegacyArmor(t *testing.T) {
	encoded := EncodeArmor("TENDERMINT PRIVATE KEY", nil, []byte{1, 2, 3, 4})
	start := strings.Index(encoded, "\n\n") + 2
	if start < 2 || start >= len(encoded) {
		t.Fatal("missing armor body")
	}
	corrupt := encoded[:start] + "!" + encoded[start+1:]
	if _, _, _, err := DecodeArmor(corrupt); err == nil {
		t.Fatal("accepted corrupt armored key data")
	}
}
