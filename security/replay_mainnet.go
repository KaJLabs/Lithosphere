// Offline application replay: this program has no signer, network client or node service.
package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"cosmossdk.io/log"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	core "github.com/cometbft/cometbft/rpc/core/types"
	cmtstate "github.com/cometbft/cometbft/state"
	cmttypes "github.com/cometbft/cometbft/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/baseapp"
	"github.com/crypto-org-chain/cronos/memiavl"
	"github.com/evmos/evmos/v20/app"
)

type options map[string]interface{}
func (o options) Get(key string) interface{} { return o[key] }

func readResult(dir, kind string, height int64, value interface{}) {
	raw, err := os.ReadFile(filepath.Join(dir, fmt.Sprintf("%s-%d.json", kind, height)))
	if err != nil { panic(err) }
	var envelope struct { Result json.RawMessage `json:"result"` }
	if err = json.Unmarshal(raw, &envelope); err != nil { panic(err) }
	if err = cmtjson.Unmarshal(envelope.Result, value); err != nil { panic(err) }
}

func main() {
	if len(os.Args) != 5 { panic("usage: replay disposable-home block-inputs snapshot-height count") }
	home, err := filepath.Abs(os.Args[1]); if err != nil { panic(err) }
	if !strings.HasPrefix(home, "/home/bachal/litho-l1-mainnet-replay-20261021-rc3/") { panic("home is outside the disposable replay directory") }
	if _, err = os.Stat(filepath.Join(home, "REPLAY_ONLY")); err != nil { panic("missing replay marker") }
	height, err := strconv.ParseInt(os.Args[3], 10, 64); if err != nil { panic(err) }
	count, err := strconv.Atoi(os.Args[4]); if err != nil || count < 1 || count > 128 { panic("invalid replay count") }
	dir := os.Args[2]
	// The copied snapshot deliberately has no live WAL. Reset only its local WAL
	// origin exactly as memiavl's state-sync importer does (import.go:255).
	// Keep CommitInfo, tree files and the immutable source archive unchanged.
	metadataPath := filepath.Join(home, "data/memiavl.db/current/__metadata")
	rawMetadata, err := os.ReadFile(metadataPath); if err != nil { panic(err) }
	var metadata memiavl.MultiTreeMetadata
	if err = metadata.Unmarshal(rawMetadata); err != nil { panic(err) }
	if metadata.CommitInfo.Version != height { panic("unexpected snapshot metadata height") }
	oldOrigin := metadata.InitialVersion
	metadata.InitialVersion = height + 1
	replayMetadata, err := metadata.Marshal(); if err != nil { panic(err) }
	if err = os.WriteFile(metadataPath, replayMetadata, 0600); err != nil { panic(err) }
	preparation, _ := json.Marshal(map[string]interface{}{"replayPreparation":"snapshot-only WAL origin",
		"previousInitialVersion":oldOrigin, "replayInitialVersion":metadata.InitialVersion,
		"commitInfoAndTreeFilesUnchanged":true})
	fmt.Println(string(preparation))
	node := app.NewEvmos(log.NewNopLogger(), dbm.NewMemDB(), nil, true, map[int64]bool{}, home, 0,
		options{"home":home, "memiavl.enable":true, "memiavl.snapshot-interval":uint32(1000000),
			"memiavl.snapshot-keep-recent":uint32(2), "memiavl.async-commit-buffer":0,
			"memiavl.zero-copy":false, "minimum-gas-prices":"0ulitho"},
		baseapp.SetChainID("lithosphere_9005-1"))
	defer node.Close()
	if node.LastBlockHeight() != height { panic(fmt.Sprintf("snapshot height %d != requested %d", node.LastBlockHeight(), height)) }
	for offset := 1; offset <= count; offset++ {
		h := height + int64(offset)
		var block, next core.ResultBlock
		var validators, lastValidators core.ResultValidators
		var signed core.ResultCommit
		readResult(dir, "block", h, &block)
		readResult(dir, "block", h+1, &next)
		readResult(dir, "validators", h, &validators)
		readResult(dir, "validators", h-1, &lastValidators)
		readResult(dir, "commit", h, &signed)
		b := block.Block
		if b.ChainID != "lithosphere_9005-1" || b.Height != h || len(b.Evidence.Evidence) != 0 { panic("unsupported chain/height/evidence") }
		if !bytes.Equal(b.Hash(), block.BlockID.Hash) || !bytes.Equal(signed.Header.Hash(), b.Hash()) { panic("block/header hash mismatch") }
		vals := cmttypes.NewValidatorSet(validators.Validators)
		if !bytes.Equal(vals.Hash(), b.ValidatorsHash) { panic("validator hash mismatch") }
		if err = vals.VerifyCommitLight(b.ChainID, block.BlockID, h, signed.Commit); err != nil { panic(err) }
		if !bytes.Equal(node.LastCommitID().Hash, b.AppHash) { panic(fmt.Sprintf("pre-state hash mismatch at %d", h)) }
		result, err := node.FinalizeBlock(&abci.RequestFinalizeBlock{Hash:b.Hash(), Height:h, Time:b.Time,
			Txs:b.Txs.ToSliceOfBytes(), NextValidatorsHash:b.NextValidatorsHash, ProposerAddress:b.ProposerAddress,
			DecidedLastCommit:cmtstate.BuildLastCommitInfo(b, cmttypes.NewValidatorSet(lastValidators.Validators), 1)})
		if err != nil { panic(err) }
		if !bytes.Equal(result.AppHash, next.Block.AppHash) { panic(fmt.Sprintf("application hash mismatch at %d: got %X expected %X", h, result.AppHash, next.Block.AppHash)) }
		if _, err = node.Commit(); err != nil { panic(err) }
		row := map[string]interface{}{"height":h, "appHash":strings.ToUpper(hex.EncodeToString(result.AppHash)),
			"transactions":len(b.Txs), "commitSignaturesVerified":true, "canonicalAppHashMatch":true}
		encoded, _ := json.Marshal(row); fmt.Println(string(encoded))
	}
}
