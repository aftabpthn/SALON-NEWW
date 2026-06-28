import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const service = read("server/services/membership-enterprise.service.js");
const routes = read("server/routes/membership-enterprise.routes.js");
const component = read("src/app/pages/memberships.component.ts");
const reports = read("src/app/pages/reports.component.ts");

assert.match(routes, /\/membership-enterprise\/reports\/sales-by-customer/);
assert.match(routes, /membershipSalesByCustomerReport\(req\.query,\s*req\.access\)/);

assert.match(service, /membershipSalesByCustomerReport\(query = \{\}, access\)/);
assert.match(service, /reports:\s*\{[\s\S]*membershipSalesByCustomer/);
assert.match(service, /metrics:\s*\{[\s\S]*membershipSalesByCustomer/);
assert.match(service, /client_membership_ledger/);
assert.match(service, /membership_invoice_snapshots/);
assert.match(service, /latestWalletBalanceByClient/);
assert.match(service, /membershipSalesByCustomerEvents/);
assert.match(service, /New Sale/);
assert.match(service, /Renewal/);
assert.match(service, /membership_sales_by_customer/);
assert.match(service, /saleType/);
assert.match(service, /totalOfferPrice/);
assert.match(service, /pendingEwallet/);

assert.match(component, /membershipSalesByCustomer/);
assert.match(component, /Membership Sales By Customer/);
assert.match(component, /Total Offer Price/);
assert.match(component, /Pending Ewallet/);
assert.match(component, /reportFilters\.saleType/);
assert.match(component, /invoice:\s*row\['invoiceId'\]/);
assert.match(component, /\['\/clients', row\['clientId'\]\]/);
assert.match(component, /\['\/memberships', row\['membershipId'\]\]/);

assert.match(reports, /Membership Sales By Customer/);
assert.match(reports, /report:\s*'membershipSalesByCustomer'/);

console.log("membership sales by customer report wiring ok");
