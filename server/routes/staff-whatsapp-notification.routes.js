import { Router } from "express";
import { staffWhatsappNotificationService } from "../services/staff-whatsapp-notification.service.js";
import { route } from "./staff-os-route-utils.js";
import { requireStaffAppPermission } from "../middleware/rbac.js";

export const staffWhatsappNotificationRouter = Router();

const canReadStaffNotifications = requireStaffAppPermission("read", "staff-app-notifications");
const canWriteStaffNotifications = requireStaffAppPermission("write", "staff-app-notifications");

staffWhatsappNotificationRouter.get("/staff-os/notifications/templates", canReadStaffNotifications, route((req, res) => res.json(staffWhatsappNotificationService.listTemplates(req.query, req.access))));
staffWhatsappNotificationRouter.post("/staff-os/notifications/templates", canWriteStaffNotifications, route((req, res) => res.status(201).json(staffWhatsappNotificationService.createTemplate(req.body, req.access))));
staffWhatsappNotificationRouter.post("/staff-os/notifications/queue", canWriteStaffNotifications, route((req, res) => res.status(201).json(staffWhatsappNotificationService.queue(req.body, req.access))));
staffWhatsappNotificationRouter.post("/staff-os/notifications/:id/approve", canWriteStaffNotifications, route((req, res) => res.json(staffWhatsappNotificationService.approve(req.params.id, req.access))));
staffWhatsappNotificationRouter.post("/staff-os/notifications/:id/mark-sent", canWriteStaffNotifications, route((req, res) => res.json(staffWhatsappNotificationService.markSent(req.params.id, req.body, req.access))));
staffWhatsappNotificationRouter.get("/staff-os/notifications/logs", canReadStaffNotifications, route((req, res) => res.json(staffWhatsappNotificationService.logs(req.query, req.access))));
