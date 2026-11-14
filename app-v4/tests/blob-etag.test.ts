import { test } from "node:test";
import assert from "node:assert/strict";
import { strongEtag } from "../lib/server/state";

test("a weak Blob ETag from get() becomes the strong ETag put({ ifMatch }) expects", () => {
  assert.equal(strongEtag('W/"46beab511bdb581c5e68539bae973311"'), '"46beab511bdb581c5e68539bae973311"');
  assert.equal(strongEtag('"46beab511bdb581c5e68539bae973311"'), '"46beab511bdb581c5e68539bae973311"');
  assert.equal(strongEtag(undefined), undefined);
});
