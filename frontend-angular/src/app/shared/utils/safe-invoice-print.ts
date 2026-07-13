type InvoicePrintPayload = {
  invoice?: any;
  sale?: any;
  lines?: any[];
  payments?: any[];
  paymentSplit?: any;
  payment_split?: any;
};

export function printInvoiceDocument(payload: InvoicePrintPayload): boolean {
  const html = renderInvoiceDocument(payload);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const popup = window.open(url, '_blank', 'width=900,height=700,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Boolean(popup);
}

export function downloadInvoiceDocument(payload: InvoicePrintPayload, fileName: string): boolean {
  const html = renderInvoiceDocument(payload);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileName(fileName || 'invoice')}.html`;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

function renderInvoiceDocument(payload: InvoicePrintPayload): string {
  const invoice = payload.invoice ?? payload.sale ?? payload;
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  const invoiceNumber = text(invoice?.invoiceNumber ?? invoice?.invoice_number ?? invoice?.id ?? 'Invoice');
  const clientName = text(invoice?.clientName ?? invoice?.client_name ?? 'Walk-in client');
  const businessDate = displayDate(invoice?.businessDate ?? invoice?.business_date ?? invoice?.createdAt ?? invoice?.created_at ?? '');
  const totalPaise = moneyNumber(invoice?.totalPaise ?? invoice?.total_paise);
  const paidPaise = moneyNumber(invoice?.paidPaise ?? invoice?.paid_paise);
  const balancePaise = moneyNumber(invoice?.balancePaise ?? invoice?.balance_paise);

  return `<!doctype html><html><head><meta charset="utf-8"><title>${invoiceNumber}</title><style>
    body{font-family:Arial,sans-serif;margin:24px;color:#111827}h1{font-size:22px;margin:0 0 4px}.muted{color:#64748b}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:18px 0}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left}th{font-size:12px;text-transform:uppercase;color:#475569}.totals{margin-top:18px;margin-left:auto;width:280px}.totals div{display:flex;justify-content:space-between;padding:6px 0}.total{font-weight:700;border-top:1px solid #0f172a}@media print{button{display:none}body{margin:0}}
  </style></head><body><button onclick="window.print()">Print</button><h1>${invoiceNumber}</h1><div class="muted">${businessDate}</div><section class="meta"><div><strong>Client</strong><br>${clientName}</div><div><strong>Status</strong><br>${text(invoice?.status ?? '')}</div></section><table><thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead><tbody>${lineRows(lines)}</tbody></table><section class="totals"><div><span>Total</span><strong>${formatMoney(totalPaise)}</strong></div><div><span>Paid</span><strong>${formatMoney(paidPaise)}</strong></div><div class="total"><span>Balance</span><strong>${formatMoney(balancePaise)}</strong></div></section>${paymentRows(payments)}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),100));</script></body></html>`;
}

function lineRows(lines: any[]): string {
  if (!lines.length) return '<tr><td colspan="3" class="muted">No line items</td></tr>';
  return lines.map((line) => `<tr><td>${text(line?.name ?? line?.itemName ?? line?.item_name ?? line?.serviceName ?? line?.service_name ?? line?.productName ?? line?.product_name ?? 'Item')}</td><td>${text(line?.quantity ?? line?.qty ?? 1)}</td><td>${formatMoney(moneyNumber(line?.lineTotalPaise ?? line?.line_total_paise ?? line?.totalPaise ?? line?.total_paise))}</td></tr>`).join('');
}

function paymentRows(payments: any[]): string {
  if (!payments.length) return '';
  const rows = payments.map((payment) => `<tr><td>${text(payment?.method ?? payment?.mode ?? '')}</td><td>${formatMoney(moneyNumber(payment?.amountPaise ?? payment?.amount_paise))}</td></tr>`).join('');
  return `<h2>Payments</h2><table><thead><tr><th>Mode</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function text(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] ?? char));
}

function moneyNumber(value: unknown): number {
  return Math.round(Number(value) || 0);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value / 100);
}

function displayDate(value: unknown): string {
  const raw = String(value ?? '').slice(0, 10);
  const parts = raw.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : text(raw);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'invoice';
}
