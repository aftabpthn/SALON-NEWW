import { db } from "../db.js";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../db/migrations/20260714_security_ephemeral_grants.sql", import.meta.url), "utf8");

export function ensureSecurityEphemeralGrantsSchema(database = db) {
  database.exec(migration);
}
