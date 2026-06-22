import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const posInvoicesPage = readFileSync("src/app/pages/pos-invoices.component.ts", "utf8");

test("invoice register shows compact settlement snippet and whatsapp queue preview", () => {
  assert.match(posInvoicesPage, /<small class="row-subcopy">\{\{ settlementSnippet\(row\) \}\}<\/small>/, "Invoice list row should show compact settlement snippet");
  assert.match(posInvoicesPage, /<small class="queue-preview-chip" \*ngIf="whatsappQueuePreview\(row\) as preview">WA queued: \{\{ preview \}\}<\/small>/, "Invoice list row should show queued WhatsApp preview");
  assert.match(posInvoicesPage, /invoice-notifications\/queue', \{ limit: 1000 \}\)\.pipe\(catchError\(\(\) => of\(\[\]\)\)\)/, "Invoice register should load notification queue safely");
  assert.match(posInvoicesPage, /settlementSnippet\(row: InvoiceRegisterRow\): string/, "Invoice register should derive a reusable compact settlement line");
  assert.match(posInvoicesPage, /whatsappQueuePreview\(row: InvoiceRegisterRow\): string/, "Invoice register should derive preview text from queued WhatsApp rows");
  assert.match(posInvoicesPage, /line\.startsWith\('Advance adjusted:'\)/, "Queue preview should pick the settlement line from the queued message body");
});
