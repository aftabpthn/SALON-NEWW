import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { appointmentActivityService } from "../services/appointment-activity.service.js";

export const appointmentActivityRouter = Router();

appointmentActivityRouter.get(
  "/appointment-activity/register",
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    const register = appointmentActivityService.register(req.query, req.access);
    if (req.query.format === "csv") {
      res.type("text/csv").send(toRegisterCsv(register.rows));
      return;
    }
    if (req.query.format === "pdf") {
      res.type("application/pdf").send(simpleRegisterPdf(register));
      return;
    }
    res.json(register);
  })
);

appointmentActivityRouter.get(
  "/appointment-reports",
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(appointmentActivityService.register(req.query, req.access));
  })
);

appointmentActivityRouter.get(
  "/appointment-activity/reports",
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    const report = appointmentActivityService.reports(req.query, req.access);
    if (req.query.format === "csv") {
      res.type("text/csv").send(toCsv(report.exportRows));
      return;
    }
    if (req.query.format === "pdf") {
      res.type("application/pdf").send(simplePdf(report));
      return;
    }
    res.json(report);
  })
);

appointmentActivityRouter.get(
  "/appointment-activity/clients/:clientId",
  requirePermission("read", () => "clients"),
  asyncHandler((req, res) => {
    res.json(appointmentActivityService.clientHistory(req.params.clientId, req.query, req.access));
  })
);

appointmentActivityRouter.get(
  "/appointment-activity/appointments/:appointmentId/timeline",
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json({ timeline: appointmentActivityService.appointmentTimeline(req.params.appointmentId, req.access) });
  })
);

appointmentActivityRouter.get(
  "/appointment-activity/:id",
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(appointmentActivityService.get(req.params.id, req.access));
  })
);

appointmentActivityRouter.get(
  "/appointment-activity",
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json({
      rows: appointmentActivityService.list(req.query, req.access),
      generatedAt: new Date().toISOString()
    });
  })
);

appointmentActivityRouter.get(
  "/appointment-history/client/:clientId",
  requirePermission("read", () => "clients"),
  asyncHandler((req, res) => {
    res.json({ success: true, data: appointmentActivityService.clientHistory(req.params.clientId, req.query, req.access) });
  })
);

appointmentActivityRouter.get(
  "/appointment-history/appointment/:appointmentId/timeline",
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json({ success: true, data: appointmentActivityService.appointmentTimeline(req.params.appointmentId, req.access) });
  })
);

function toCsv(rows = []) {
  const headers = [
    "createdAt",
    "appointmentId",
    "clientName",
    "clientPhone",
    "staffName",
    "branchName",
    "action",
    "reason",
    "statusBefore",
    "statusAfter",
    "riskLevel",
    "riskScore",
    "riskReason",
    "suggestedAction"
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ].join("\n");
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function toRegisterCsv(rows = []) {
  const headers = [
    "bookedAt",
    "appointmentStartAt",
    "clientName",
    "clientPhone",
    "staffName",
    "serviceNames",
    "status",
    "cancelReason",
    "paymentStatus",
    "invoiceNumber",
    "total",
    "paid",
    "balance",
    "bookingMode",
    "createdBy",
    "lastUpdatedBy",
    "problemFlags"
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(Array.isArray(row[header]) ? row[header].join("; ") : row[header])).join(","))
  ].join("\n");
}

function simplePdf(report) {
  const lines = [
    "Aura Salon OS - Appointment Activity Report",
    `Generated: ${report.generatedAt}`,
    `Activities: ${report.summary.totalActivities}`,
    `Cancellations: ${report.summary.cancellations} | Reschedules: ${report.summary.reschedules} | No-shows: ${report.summary.noShows}`,
    `High risk: ${report.summary.highRiskActivities} | Critical: ${report.summary.criticalActivities}`,
    "",
    "Daily summary",
    ...report.dailySummary.slice(0, 18).map((row) => `${row.date} - total ${row.total}, cancel ${row.cancellations}, reschedule ${row.reschedules}, no-show ${row.noShows}`),
    "",
    "Client reliability watch",
    ...report.clientReliability.slice(0, 18).map((row) => `${row.clientName} - score ${row.reliabilityScore}, cancel ${row.cancellations}, no-show ${row.noShows}`)
  ];
  const stream = [
    "BT",
    "/F1 10 Tf",
    "50 780 Td",
    "14 TL",
    ...lines.slice(0, 70).flatMap((line) => [`(${pdfText(line).slice(0, 110)}) Tj`, "T*"]),
    "ET"
  ].join("\n");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object) => {
    offsets.push(pdf.length);
    pdf += object;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}

function simpleRegisterPdf(register) {
  const lines = [
    "Aura Salon OS - Appointment Register",
    `Generated: ${register.generatedAt}`,
    `Appointments: ${register.summary.totalAppointments}`,
    `Completed: ${register.summary.completed} | Cancelled: ${register.summary.cancelled} | Pending: ${register.summary.pending}`,
    `Billed: ${register.summary.billedAmount} | Unpaid: ${register.summary.unpaidAmount}`,
    "",
    "Recent appointments",
    ...register.rows.slice(0, 35).map((row) => `${row.appointmentStartAt} - ${row.clientName} - ${row.serviceNames || row.appointmentId} - ${row.status} - ${row.invoiceNumber || "No invoice"}`)
  ];
  const stream = [
    "BT",
    "/F1 10 Tf",
    "50 780 Td",
    "14 TL",
    ...lines.slice(0, 70).flatMap((line) => [`(${pdfText(line).slice(0, 110)}) Tj`, "T*"]),
    "ET"
  ].join("\n");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object) => {
    offsets.push(pdf.length);
    pdf += object;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}

function pdfText(value) {
  return String(value ?? "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/[\\()]/g, "\\$&")
    .replace(/[\r\n]+/g, " ");
}
