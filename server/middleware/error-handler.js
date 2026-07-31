import { existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.js";

function getClientIndexPath() {
  const candidates = [
    join(process.cwd(), "customer-app", "www"),
    join(process.cwd(), "customer-app", "dist", "browser"),
    join(process.cwd(), "customer-app", "dist"),
    join(process.cwd(), "www"),
    join(process.cwd(), "dist", "aura-salon-crm-pos", "browser"),
    join(process.cwd(), "dist", "aura-salon-crm-pos"),
    join(process.cwd(), "dist"),
    join(process.cwd(), "public")
  ];
  const dist = candidates.find((candidate) => existsSync(join(candidate, "index.html")));
  return dist ? join(dist, "index.html") : null;
}

export function notFoundHandler(req, res, next) {
  if (req.method === "GET" && !req.originalUrl.startsWith("/api") && !req.originalUrl.includes(".")) {
    const indexPath = getClientIndexPath();
    if (indexPath) {
      res.sendFile(indexPath);
      return;
    }
  }

  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.status = 404;
  next(error);
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const response = {
    error: err.message || "Internal server error",
    status,
    requestId: req.requestId
  };
  if (err.details) response.details = err.details;

  if (status >= 500) {
    console.error("=== ERROR HANDLER ===");
    console.error("METHOD =", req.method);
    console.error("PATH =", req.originalUrl);
    console.error("STATUS =", status);
    console.error("MESSAGE =", err.message);
    console.error("STACK =", err.stack);
    console.error("=== END ERROR HANDLER ===");
  }

  logger.error("request_error", {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    status,
    error: err.message,
    stack: status >= 500 ? err.stack : undefined
  });

  if (req.apiVersion === "v1") {
    res.status(status).json({
      success: false,
      error: {
        message: response.error,
        status,
        details: response.details
      },
      meta: {
        requestId: req.requestId,
        version: req.apiVersion,
        timestamp: new Date().toISOString()
      }
    });
    return;
  }

  res.status(status).json(response);
}
