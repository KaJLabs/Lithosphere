import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("API and signer source-evidence checks remain identical", async () => {
  const [apiSource, signerSource] = await Promise.all([
    readFile(new URL("../src/services/sourceEvidence.js", import.meta.url), "utf8"),
    readFile(new URL("../../signer/src/sourceEvidence.js", import.meta.url), "utf8"),
  ]);

  assert.equal(apiSource, signerSource);
});
