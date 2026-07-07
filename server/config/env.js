import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

loadLocalEnv();

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 4000),
  allowedOrigins: (process.env.CORS_ORIGINS || "http://127.0.0.1:4300,http://localhost:4300")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || "8mb",
  logLevel: process.env.LOG_LEVEL || "info",
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-this-mobile-secret",
  encryptionSecret: process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET || "dev-only-change-this-encryption-secret",
  jwtAccessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS || 900),
  jwtRefreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS || 30),
  allowLegacyRefreshTokenBody: (process.env.ALLOW_LEGACY_REFRESH_TOKEN_BODY || "true") === "true",
  allowRefreshTokenInResponse: (process.env.ALLOW_REFRESH_TOKEN_IN_RESPONSE || "true") === "true",
  refreshCookieName: process.env.REFRESH_COOKIE_NAME || (process.env.NODE_ENV === "production" ? "__Host-aura_refresh" : "aura_refresh"),
  refreshCookieSameSite: process.env.REFRESH_COOKIE_SAMESITE || "Strict",
  trustProxy: (process.env.TRUST_PROXY || "false") === "true",
  enterpriseRateLimitMax: Number(process.env.ENTERPRISE_RATE_LIMIT_MAX || (process.env.NODE_ENV === "production" ? 240 : 2000)),
  requirePasswordAuth: (process.env.REQUIRE_PASSWORD_AUTH || (process.env.NODE_ENV === "production" ? "true" : "false")) === "true",
  demoAdminPassword: process.env.DEMO_ADMIN_PASSWORD || "AuraOwner#2026",
  apiVersion: "v1",
  aiProvider: process.env.AI_PROVIDER || "local",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
  liveConsultationProvider: process.env.AI_CONSULTATION_PROVIDER || process.env.LIVE_CONSULTATION_PROVIDER || "",
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  firebaseProjectId: process.env.CUSTOMER_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "",
  firebaseClientEmail: process.env.CUSTOMER_FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL || "",
  firebasePrivateKey: process.env.CUSTOMER_FIREBASE_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || "",
  firebaseServiceAccountJson: process.env.CUSTOMER_FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
  whatsappProvider: process.env.WHATSAPP_PROVIDER || "local",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
  whatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "aura_whatsapp_verify_2026",
  metaGraphVersion: process.env.META_GRAPH_VERSION || "v20.0"
};

function loadLocalEnv() {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  [".env.local", ".env"].forEach((fileName) => {
    const filePath = resolve(rootDir, fileName);
    if (!existsSync(filePath)) return;
    readFileSync(filePath, "utf8").split(/\r?\n/).forEach(applyEnvLine);
  });
}

function applyEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return;
  const source = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const equalsAt = source.indexOf("=");
  if (equalsAt <= 0) return;
  const key = source.slice(0, equalsAt).trim();
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || process.env[key]) return;
  process.env[key] = unquoteEnvValue(source.slice(equalsAt + 1).trim());
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}


