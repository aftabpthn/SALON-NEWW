import { Router } from "express";
import { requireStaffAppSelfPermission } from "../middleware/rbac.js";
import { staffLeaveRequestService } from "../services/staff-leave-request.service.js";
import { staffMobileService } from "../services/staff-mobile.service.js";
import { staffSelfResponsePresenterService } from "../services/staff-self-response-presenter.service.js";
import { route } from "./staff-os-route-utils.js";
import { derivedStaffMutation, derivedStaffQuery } from "../middleware/staff-self-context.middleware.js";

export const staffMobileRouter = Router();

const canReadAppointments = requireStaffAppSelfPermission("read", "staff-app-appointments");
const canReadPayroll = requireStaffAppSelfPermission("read", "staff-app-payroll");
const canReadStaff = requireStaffAppSelfPermission("read", "staff-app-staff");
const canRequestStaffLeave = requireStaffAppSelfPermission("write", "staff-app-staff");

staffMobileRouter.get("/staff-os/mobile/dashboard", canReadAppointments, derivedStaffQuery(), route((req, res) => res.json(staffSelfResponsePresenterService.staffData(staffMobileService.mobileDashboard(req.query, req.access), req.access))));
staffMobileRouter.get("/staff-os/mobile/today", canReadAppointments, derivedStaffQuery(), route((req, res) => res.json(staffSelfResponsePresenterService.staffData(staffMobileService.mobileToday(req.query, req.access), req.access))));
staffMobileRouter.get("/staff-os/mobile/payroll", canReadPayroll, derivedStaffQuery(), route((req, res) => res.json(staffMobileService.mobilePayroll(req.query, req.access))));
staffMobileRouter.get("/staff-os/mobile/targets", canReadStaff, derivedStaffQuery(), route((req, res) => res.json(staffMobileService.mobileTargets(req.query, req.access))));
staffMobileRouter.post("/staff-os/mobile/request-leave", canRequestStaffLeave, derivedStaffMutation(), route((req, res) => res.status(201).json(staffLeaveRequestService.requestLeave(req.body, req.access))));
