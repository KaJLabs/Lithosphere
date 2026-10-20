package baseapp

import (
	sdk "github.com/cosmos/cosmos-sdk/types"
	"io"
)

// closeQueryContext releases a request-owned snapshot after its handler returns.
// Stores that do not own a snapshot need not implement io.Closer.
func (app *BaseApp) closeQueryContext(ctx sdk.Context) {
	if closer, ok := ctx.MultiStore().(io.Closer); ok {
		if err := closer.Close(); err != nil {
			app.logger.Error("failed to close query snapshot", "err", err)
		}
	}
}
