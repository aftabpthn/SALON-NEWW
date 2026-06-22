import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const posPage = readFileSync("src/app/pages/pos.component.ts", "utf8");

test("generated invoice preview keeps a settlement recap after checkout", () => {
  assert.match(posPage, /<section class="generated-settlement-card" \*ngIf="generatedInvoiceSettlement\(\) as settlement">/, "Generated invoice card should show a settlement recap block");
  assert.match(posPage, /Settlement recap/, "Generated invoice card should label the recap clearly");
  assert.match(posPage, /Advance adjusted/, "Generated invoice recap should show adjusted advance");
  assert.match(posPage, /Counter paid/, "Generated invoice recap should show counter paid");
  assert.match(posPage, /Counter due/, "Generated invoice recap should show counter due");
  assert.match(posPage, /WhatsApp summary: \{\{ generatedInvoiceWhatsappPreview\(settlement\) \}\}/, "Generated invoice card should preview the client-facing WhatsApp settlement line");
  assert.match(posPage, /generatedInvoiceWhatsappPreview\(settlement: \{ advance: number; counter: number; due: number; walletCredit: number \}\): string/, "POS should build the WhatsApp settlement preview from the saved recap");
  assert.match(posPage, /readonly generatedInvoiceSettlement = signal<\{ advance: number; counter: number; due: number; walletCredit: number \} \| null>\(null\);/, "POS should persist the final settlement recap in signal state");
  assert.match(posPage, /const settlementPreview = this\.currentSettlementPreview\(\);/, "Checkout should capture the live settlement split before save");
  assert.match(posPage, /this\.generatedInvoiceSettlement\.set\(settlementPreview \|\| this\.currentSettlementPreview\(\)\);/, "Finish checkout should freeze the settlement recap for the generated invoice card");
});
