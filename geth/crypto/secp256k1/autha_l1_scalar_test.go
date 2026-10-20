package secp256k1

// Autha L1-R1: the C half of the 895a8597 backport (ext.h, secp256k1_ext_scalar_mul) has no test in the
// candidate. These checks fail if the field-range guard on the input point is removed.

import (
	"math/big"
	"testing"
)

func TestAuthaL1ScalarMultRejectsOutOfFieldCoordinates(t *testing.T) {
	c := S256()
	x := big.NewInt(1) // (1, y) is on secp256k1, and 1+P still fits in 32 bytes
	y, _ := new(big.Int).SetString("4218f20ae6c646b363db68605822fb14264ca8d2587fdd6fbc750d587e76a7ee", 16)
	if !c.IsOnCurve(x, y) {
		t.Fatal("fixture point is not on the curve")
	}
	k := make([]byte, 32)
	k[31] = 3
	if rx, ry := c.ScalarMult(x, y, k); rx == nil || ry == nil {
		t.Fatal("canonical point rejected")
	}
	if rx, _ := c.ScalarMult(new(big.Int).Add(x, c.P), y, k); rx != nil {
		t.Fatal("ScalarMult accepted an x coordinate outside the field")
	}
	if rx, _ := c.ScalarMult(x, new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)), k); rx != nil {
		t.Fatal("ScalarMult accepted a y coordinate outside the field")
	}
}
