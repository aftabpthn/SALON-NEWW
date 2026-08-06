import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireIdempotencyKey } from "../middleware/idempotency.middleware.js";
import { ownerPeopleService } from "../services/owner-people.service.js";
import { forbidden } from "../utils/app-error.js";

export const ownerPeopleRouter = Router();
const readStaff = requirePermission("read", () => "staff");
const writeStaff = requirePermission("write", () => "staff");
const readPayroll = requirePermission("read", () => "payroll");
const writePayroll = requirePermission("write", () => "payroll");
ownerPeopleRouter.use("/owner-console/people", (req, _res, next) => req.access?.role === "owner" ? next() : next(forbidden("Owner role is required")));

ownerPeopleRouter.get("/owner-console/people/staff", readStaff, asyncHandler((req, res) => res.json(ownerPeopleService.listStaff(req.access, req.query))));
ownerPeopleRouter.post("/owner-console/people/staff", writeStaff, asyncHandler((req, res) => res.status(201).json(ownerPeopleService.createStaff(req.body, req.access))));
ownerPeopleRouter.get("/owner-console/people/staff/:id", readStaff, asyncHandler((req, res) => res.json(ownerPeopleService.staffDetail(req.params.id, req.access, req.query))));
ownerPeopleRouter.patch("/owner-console/people/staff/:id", writeStaff, asyncHandler((req, res) => res.json(ownerPeopleService.updateStaff(req.params.id, req.body, req.access))));
ownerPeopleRouter.patch("/owner-console/people/staff/:id/status", writeStaff, asyncHandler((req, res) => res.json(ownerPeopleService.updateStatus(req.params.id, req.body, req.access))));
ownerPeopleRouter.post("/owner-console/people/staff/:id/login", writeStaff, asyncHandler((req, res) => res.json(ownerPeopleService.updateLogin(req.params.id, req.body, req.access))));
ownerPeopleRouter.post("/owner-console/people/staff/:id/transfer", writeStaff, asyncHandler((req, res) => res.json(ownerPeopleService.transfer(req.params.id, req.body, req.access))));
ownerPeopleRouter.post("/owner-console/people/staff/:id/schedules", writeStaff, asyncHandler((req, res) => res.status(201).json(ownerPeopleService.createSchedule(req.params.id, req.body, req.access))));
ownerPeopleRouter.post("/owner-console/people/staff/:id/commissions", writeStaff, asyncHandler((req, res) => res.status(201).json(ownerPeopleService.calculateCommission(req.params.id, req.body, req.access))));
ownerPeopleRouter.post("/owner-console/people/commissions/:id/approve", writeStaff, asyncHandler((req, res) => res.json(ownerPeopleService.approveCommission(req.params.id, req.access))));

ownerPeopleRouter.get("/owner-console/people/attendance", readStaff, asyncHandler((req, res) => res.json(ownerPeopleService.attendance(req.access, req.query))));
ownerPeopleRouter.get("/owner-console/people/attendance/:id", readStaff, asyncHandler((req, res) => res.json(ownerPeopleService.attendanceDetail(req.params.id, req.access))));
ownerPeopleRouter.post("/owner-console/people/attendance/:id/corrections", writeStaff, asyncHandler((req, res) => res.status(201).json(ownerPeopleService.correctAttendance(req.params.id, req.body, req.access))));
ownerPeopleRouter.post("/owner-console/people/attendance/:id/reset", writeStaff, asyncHandler((req, res) => res.json(ownerPeopleService.resetAttendance(req.params.id, req.body, req.access))));
ownerPeopleRouter.get("/owner-console/people/leaves", readStaff, asyncHandler((req, res) => res.json(ownerPeopleService.leaves(req.access, req.query))));
ownerPeopleRouter.get("/owner-console/people/leaves/:id", readStaff, asyncHandler((req, res) => res.json(ownerPeopleService.leaveDetail(req.params.id, req.access))));
ownerPeopleRouter.patch("/owner-console/people/leaves/:id/approve", writeStaff, asyncHandler((req, res) => res.json(ownerPeopleService.decideLeave(req.params.id, "approved", req.body, req.access))));
ownerPeopleRouter.patch("/owner-console/people/leaves/:id/reject", writeStaff, asyncHandler((req, res) => res.json(ownerPeopleService.decideLeave(req.params.id, "rejected", req.body, req.access))));
ownerPeopleRouter.post("/owner-console/people/payroll/generate", writePayroll, requireIdempotencyKey, asyncHandler((req, res) => res.status(201).json(ownerPeopleService.generatePayroll(req.body, req.access))));
ownerPeopleRouter.get("/owner-console/people/payroll", readPayroll, asyncHandler((req, res) => res.json(ownerPeopleService.payroll(req.access, req.query))));
ownerPeopleRouter.get("/owner-console/people/payroll/:id", readPayroll, asyncHandler((req, res) => res.json(ownerPeopleService.payrollDetail(req.params.id, req.access))));
ownerPeopleRouter.post("/owner-console/people/payroll/:id/approve", writePayroll, asyncHandler((req, res) => res.json(ownerPeopleService.approvePayroll(req.params.id, req.access))));
ownerPeopleRouter.post("/owner-console/people/payroll/:id/mark-paid", writePayroll, asyncHandler((req, res) => res.json(ownerPeopleService.markPayrollPaid(req.params.id, req.access))));
