import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("Phase 10 collaboration stays persisted and permission checked", () => {
  const migration = read("backend-rust/migrations/0385_staff_collaboration_operations.sql");
  const chat = read("backend-rust/src/services/team_chat_service.rs");
  const routes = read("backend-rust/src/routes/notifications.rs");
  const staffChat = read("staff-app/src/app/features/staff/staff-chat.page.ts");
  const tasks = read("staff-app/src/app/features/staff/staff-tasks.page.ts");

  for (const table of ["staff_chat_attachments", "team_chat_read_state", "staff_surveys", "staff_survey_responses"]) assert.match(migration, new RegExp(table));
  assert.match(chat, /conversation_type.*direct.*group.*broadcast/s);
  assert.match(routes, /resolve_staff_chat_share/);
  assert.match(routes, /scan_upload_bytes/);
  assert.match(staffChat, /markStaffConversationRead/);
  assert.match(tasks, /staff\.task\.updated/);
});
