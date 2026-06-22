import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const posInvoicesPage = readFileSync("src/app/pages/pos-invoices.component.ts", "utf8");

test("WhatsApp PDF actions explain that settlement summary goes to the client", () => {
  assert.match(posInvoicesPage, /\[title\]="whatsappSummaryTooltip\(row\)"/, "Invoice list WhatsApp button should use a settlement-aware tooltip");
  assert.match(posInvoicesPage, /\[title\]="whatsappSummaryTooltip\(invoice\)"/, "Invoice detail WhatsApp button should use a settlement-aware tooltip");
  assert.match(posInvoicesPage, /whatsappSummaryTooltip\(row: InvoiceRegisterRow\): string/, "POS invoices page should expose tooltip builder");
  assert.match(posInvoicesPage, /Client ko settlement summary line bhi saath jayegi:/, "Tooltip should clearly tell staff that the settlement summary line goes to the client");
  assert.match(posInvoicesPage, /this\.settlementSnippet\(row\)/, "Tooltip should reuse the same compact settlement snippet");
  assert.match(posInvoicesPage, /this\.notice\.set\(`WhatsApp PDF queued for \$\{invoice\.invoiceNumber\}\.\$\{dueText\} \$\{this\.settlementSnippet\(invoice\)\}`\)/, "Success notice should repeat the compact settlement snippet after queueing WhatsApp PDF");
});
