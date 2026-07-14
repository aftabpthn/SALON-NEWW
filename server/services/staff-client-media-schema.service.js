import { db } from "../db.js";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../db/migrations/20260714_staff_client_media_files.sql", import.meta.url), "utf8");

let ready = false;

export function ensureStaffClientMediaSchema() {
  if (ready) return;
  db.exec(migration);
  ready = true;
}
