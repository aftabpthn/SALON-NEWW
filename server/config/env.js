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
  requirePasswordAuth: (process.env.REQUIRE_PASSWORD_AUTH || (process.env.NODE_ENV === "production" ? "true" : "false")) === "true",
  demoAdminPassword: process.env.DEMO_ADMIN_PASSWORD || "AuraOwner#2026",
  apiVersion: "v1",
  aiProvider: process.env.AI_PROVIDER || "local",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
  whatsappProvider: process.env.WHATSAPP_PROVIDER || "local",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
  whatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "aura_whatsapp_verify_2026",
  metaGraphVersion: process.env.META_GRAPH_VERSION || "v20.0"
};
