import { Router } from "express";
import { requireAnyPermission } from "../middleware/rbac.js";
import { staffLeaveRequestService } from "../services/staff-leave-request.service.js";
import { staffMobileService } from "../services/staff-mobile.service.js";
import { staffSelfResponsePresenterService } from "../services/staff-self-response-presenter.service.js";
import { route } from "./staff-os-route-utils.js";

export const staffMobileRouter = Router();

const canReadAppointments = requireAnyPermission([{ action: "read", resource: "appointments" }]);
const canReadPayroll = requireAnyPermission([
  { action: "read", resource: "payroll" },
  { action: "read", resource: "finance" }
]);
const canReadStaff = requireAnyPermission([
  { action: "read", resource: "staff" },
  { action: "write", resource: "staff" }
]);
const canRequestStaffLeave = requireAnyPermission([
  { action: "write", resource: "staff" },
  { action: "update", resource: "staff" }
]);

staffMobileRouter.get("/staff-os/mobile/dashboard", canReadAppointments, route((req, res) => res.json(staffSelfResponsePresenterService.staffData(staffMobileService.mobileDashboard(req.query, req.access), req.access))));
staffMobileRouter.get("/staff-os/mobile/today", canReadAppointments, route((req, res) => res.json(staffSelfResponsePresenterService.staffData(staffMobileService.mobileToday(req.query, req.access), req.access))));
staffMobileRouter.get("/staff-os/mobile/payroll", canReadPayroll, route((req, res) => res.json(staffMobileService.mobilePayroll(req.query, req.access))));
staffMobileRouter.get("/staff-os/mobile/targets", canReadStaff, route((req, res) => res.json(staffMobileService.mobileTargets(req.query, req.access))));
staffMobileRouter.post("/staff-os/mobile/request-leave", canRequestStaffLeave, route((req, res) => res.status(201).json(staffLeaveRequestService.requestLeave(req.body, req.access))));
