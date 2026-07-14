const identityFields = new Set(["tenantId", "tenant_id", "userId", "user_id", "staffId", "staff_id", "branchId", "branch_id"]);

export function staffSelfContext(allowedFields = null) {
  return (req, _res, next) => {
    for (const field of identityFields) delete req.query?.[field];

    if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
      const body = {};
      for (const [key, value] of Object.entries(req.body)) {
        if (!identityFields.has(key) && (!allowedFields || allowedFields.includes(key))) body[key] = value;
      }
      req.body = body;
    }
    next();
  };
}

export function derivedStaffMutation(allowedSelfFields = null) {
  return (req, _res, next) => {
    if (!req.access?.staffId) return next();
    const body = {};
    for (const [key, value] of Object.entries(req.body || {})) {
      if (!identityFields.has(key) && (!allowedSelfFields || allowedSelfFields.includes(key))) body[key] = value;
    }
    req.body = {
      ...body,
      staffId: req.access.staffId,
      ...(req.access.branchId ? { branchId: req.access.branchId } : {})
    };
    next();
  };
}
