import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const invoicePrintService = readFileSync("server/services/invoice-print.service.js", "utf8");
const invoiceNotificationService = readFileSync("server/services/invoice-notification.service.js", "utf8");
const invoiceWhatsappService = readFileSync("server/services/invoice-whatsapp.service.js", "utf8");
const salonOperationsService = readFileSync("server/services/salon-operations.service.js", "utf8");

test("client-facing invoice outputs include advance-vs-counter settlement summary", () => {
  assert.match(invoicePrintService, /Advance adjusted: INR \$\{advanceAdjusted\.toFixed\(2\)\} \| Counter paid: INR \$\{counterPaid\.toFixed\(2\)\} \| Counter due: INR \$\{counterDue\.toFixed\(2\)\}/, "A4 print should show a short settlement summary");
  assert.match(invoicePrintService, /`Advance adjusted: INR \$\{advanceAdjusted\.toFixed\(2\)\}`/, "Thermal print should show advance adjusted");
  assert.match(invoicePrintService, /`Counter paid: INR \$\{counterPaid\.toFixed\(2\)\}`/, "Thermal print should show counter paid");
  assert.match(invoicePrintService, /`Counter due: INR \$\{counterDue\.toFixed\(2\)\}`/, "Thermal print should show counter due");
  assert.match(salonOperationsService, /<div><span>Advance adjusted<\/span><strong>\$\{invoiceMoney\(advanceAdjusted\)\}<\/strong><\/div>/, "Generated invoice HTML document should show adjusted advance");
  assert.match(salonOperationsService, /<div><span>Counter paid<\/span><strong>\$\{invoiceMoney\(counterPaid\)\}<\/strong><\/div>/, "Generated invoice HTML document should show counter paid");
  assert.match(salonOperationsService, /<div><span>Counter due<\/span><strong>\$\{invoiceMoney\(counterDue\)\}<\/strong><\/div>/, "Generated invoice HTML document should show counter due");
});

test("WhatsApp invoice bodies include the same settlement summary", () => {
  assert.match(invoiceNotificationService, /const settlementLine = `Advance adjusted: INR \$\{money\(advanceAdjusted\)\} \| Counter paid: INR \$\{money\(counterPaid\)\} \| Counter due: INR \$\{money\(counterDue\)\}`;/, "Notification context should build one shared settlement line");
  assert.match(invoiceNotificationService, /ctx\.settlementLine/, "Queued WhatsApp PDF message should include the settlement line");
  assert.match(invoiceWhatsappService, /`Advance adjusted: INR \$\{advanceAdjusted\.toFixed\(2\)\} \| Counter paid: INR \$\{counterPaid\.toFixed\(2\)\} \| Counter due: INR \$\{counterDue\.toFixed\(2\)\}`/, "WhatsApp summary helper should include settlement breakdown");
});
