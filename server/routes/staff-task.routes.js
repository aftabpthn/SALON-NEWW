import { Router } from "express";
import { requireAnyPermission } from "../middleware/rbac.js";
import { staffTaskService } from "../services/staff-task.service.js";
import { route } from "./staff-os-route-utils.js";
import { derivedStaffMutation } from "../middleware/staff-self-context.middleware.js";
import { requireIdempotencyKey } from "../middleware/idempotency.middleware.js";

export const staffTaskRouter = Router();

const canReadStaffTasks = requireAnyPermission([
  { action: "read", resource: "staff" },
  { action: "write", resource: "staff" }
]);
const canWriteStaffTasks = requireAnyPermission([
  { action: "update", resource: "staff" },
  { action: "write", resource: "staff" }
]);

staffTaskRouter.get("/staff-os/tasks", canReadStaffTasks, route((req, res) => res.json(staffTaskService.listTasks(req.query, req.access))));
staffTaskRouter.post("/staff-os/tasks", canWriteStaffTasks, route((req, res) => res.status(201).json(staffTaskService.createTask(req.body, req.access))));
staffTaskRouter.patch("/staff-os/tasks/:id", canWriteStaffTasks, derivedStaffMutation(["status", "version"]), route((req, res) => res.json(staffTaskService.updateTask(req.params.id, req.body, req.access))));
staffTaskRouter.post("/staff-os/tasks/:id/comments", canWriteStaffTasks, requireIdempotencyKey, derivedStaffMutation(["comment", "commentText", "comment_text"]), route((req, res) => res.status(201).json(staffTaskService.addTaskComment(req.params.id, req.body, req.access))));
