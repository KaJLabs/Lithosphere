package ecies

import (
	"crypto/rand"
	"errors"
	"github.com/ethereum/go-ethereum/crypto"
	"math/big"
	"testing"
)

func TestLITHORejectsInvalidSharedKeyPoints(t *testing.T) {
	private, err := GenerateKey(rand.Reader, crypto.S256(), nil)
	if err != nil {
		t.Fatal(err)
	}
	peer, err := GenerateKey(rand.Reader, crypto.S256(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = private.GenerateShared(&peer.PublicKey, 16, 16); err != nil {
		t.Fatal(err)
	}
	for _, point := range [][2]*big.Int{{nil, nil}, {big.NewInt(0), big.NewInt(0)}} {
		func() {
			defer func() {
				if value := recover(); value != nil {
					t.Errorf("panicked for invalid point: %v", value)
				}
			}()
			invalid := PublicKey{X: point[0], Y: point[1], Curve: private.Curve}
			if _, err := private.GenerateShared(&invalid, 16, 16); !errors.Is(err, ErrInvalidPublicKey) {
				t.Errorf("expected invalid public key, got %v", err)
			}
		}()
	}
}
