// Copyright Tharsis Labs Ltd.(Evmos)
// SPDX-License-Identifier:ENCL-1.0(https://github.com/evmos/evmos/blob/main/LICENSE)

package types

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLITHOInflationPermanentlyDisabled(t *testing.T) {
	params := DefaultParams()
	require.False(t, params.EnableInflation)
	require.NoError(t, params.Validate())

	params.EnableInflation = true
	require.ErrorContains(t, params.Validate(), "permanently disabled")
}
