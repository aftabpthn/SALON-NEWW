import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const posPage = readFileSync("src/app/pages/pos.component.ts", "utf8");

test("POS checkout shows a final settlement preview before save", () => {
  assert.match(posPage, /<section class="settlement-preview-bar" \*ngIf="items\(\)\.length">/, "POS should show a settlement preview bar when billing items exist");
  assert.match(posPage, /Final settlement preview/, "Preview bar should be clearly labeled");
  assert.match(posPage, /Advance adjusted/, "Preview bar should show booking advance adjustment");
  assert.match(posPage, /Counter payment/, "Preview bar should show counter collection");
  assert.match(posPage, /Due after save/, "Preview bar should show the remaining due after save");
  assert.match(posPage, /Wallet credit/, "Preview bar should support wallet-credit overpay previews");
  assert.match(posPage, /get settlementPreviewAdvance\(\): number/, "POS should expose advance preview getter");
  assert.match(posPage, /get settlementPreviewCounterCollected\(\): number/, "POS should expose counter collection preview getter");
  assert.match(posPage, /get settlementPreviewDueAfterSave\(\): number/, "POS should expose remaining due preview getter");
  assert.match(posPage, /get settlementPreviewWalletCredit\(\): number/, "POS should expose wallet credit preview getter");
});
