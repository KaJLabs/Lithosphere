package secp256k1

import (
	"math/big"
	"testing"
)

// A field-equivalent point must not pass canonical public-key validation.
func TestLITHORejectsOutOfFieldCoordinates(t *testing.T) {
	curve := S256()
	if !curve.IsOnCurve(curve.Gx, curve.Gy) {
		t.Fatal("rejected generator")
	}
	for _, point := range [][2]*big.Int{
		{new(big.Int).Add(curve.Gx, curve.P), curve.Gy},
		{curve.Gx, new(big.Int).Add(curve.Gy, curve.P)},
	} {
		if curve.IsOnCurve(point[0], point[1]) {
			t.Fatal("accepted noncanonical field coordinate")
		}
	}
}
