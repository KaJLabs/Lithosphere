package query

import (
	"cosmossdk.io/collections"
	"errors"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestLITHOPaginationReturnsTransformErrorWithoutPanic(t *testing.T) {
	store, ctx := deps()
	schema := collections.NewSchemaBuilder(store)
	values := collections.NewMap(schema, collections.NewPrefix(1), "errors", collections.Uint64Key, collections.Uint64Value)
	require.NoError(t, values.Set(ctx, 1, 42))
	want := errors.New("deliberate transform failure")
	require.NotPanics(t, func() {
		result, page, err := CollectionPaginate(ctx, values, &PageRequest{Limit: 1}, func(key, value uint64) (uint64, error) { return 0, want })
		require.ErrorIs(t, err, want)
		require.Nil(t, result)
		require.Nil(t, page)
	})
}
