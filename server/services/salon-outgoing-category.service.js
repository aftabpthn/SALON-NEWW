const CATEGORY_DEFINITIONS = [
  {
    key: "salary",
    label: "Staff Salary",
    bucket: "staff",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "salary",
    operating: true,
    patterns: ["staff salary", "salary", "payroll", "wage", "overtime"]
  },
  {
    key: "staff_commission",
    label: "Staff Commission / Incentive",
    bucket: "staff",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "staff_commission",
    operating: true,
    patterns: ["staff commission", "commission", "incentive"]
  },
  {
    key: "advance",
    label: "Staff / Client Advance",
    bucket: "advance_asset",
    impact: "Advance asset increases; cash/bank reduces",
    glCategory: "advance",
    operating: false,
    patterns: ["staff advance", "client advance", "advance"]
  },
  {
    key: "rent",
    label: "Rent / Lease",
    bucket: "operations",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "rent",
    operating: true,
    patterns: ["rent", "lease", "kiraya"]
  },
  {
    key: "utilities",
    label: "Electricity / Water / Internet",
    bucket: "operations",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "utilities",
    operating: true,
    patterns: ["utility", "utilities", "electric", "electricity", "water", "internet", "wifi", "broadband", "phone"]
  },
  {
    key: "inventory_purchase",
    label: "Product Purchase / Inventory",
    bucket: "inventory",
    impact: "Inventory asset or vendor payable is affected",
    glCategory: "inventory_purchase",
    operating: false,
    patterns: ["product purchase", "inventory purchase", "stock purchase", "purch. pymt", "vendor payment"]
  },
  {
    key: "product_consumable",
    label: "Product Consumable / COGS",
    bucket: "inventory",
    impact: "COGS/product expense reduces profit/equity",
    glCategory: "product_consumable",
    operating: true,
    patterns: ["product consumable", "consume", "consumable", "cogs", "service product"]
  },
  {
    key: "wastage_damage",
    label: "Wastage / Expiry / Damage",
    bucket: "inventory",
    impact: "Inventory value reduces and loss hits equity",
    glCategory: "product_consumable",
    operating: true,
    patterns: ["wastage", "waste", "expiry", "expired", "damage", "damaged", "shortage"]
  },
  {
    key: "fixed_asset_purchase",
    label: "Fixed Asset Purchase",
    bucket: "fixed_asset",
    impact: "Fixed asset increases; cash/bank or payable reduces",
    glCategory: "fixed_asset_purchase",
    operating: false,
    patterns: ["fixed asset", "chair", "mirror", "machine", "dryer", "steamer", "printer", "computer", "cctv", "interior", "furniture", "equipment"]
  },
  {
    key: "repair_maintenance",
    label: "Repair / Maintenance",
    bucket: "operations",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "repair_maintenance",
    operating: true,
    patterns: ["repair", "maintenance", "machine repair", "chair repair", "ac service", "plumbing", "amc"]
  },
  {
    key: "cleaning_housekeeping",
    label: "Cleaning / Laundry / Housekeeping",
    bucket: "operations",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "cleaning_housekeeping",
    operating: true,
    patterns: ["cleaning", "clean", "laundry", "towel", "housekeeping", "sanitize", "pest"]
  },
  {
    key: "client_refreshment",
    label: "Client Refreshment",
    bucket: "operations",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "other",
    operating: true,
    patterns: ["tea", "coffee", "refreshment", "snack", "water bottle", "client refreshment"]
  },
  {
    key: "uniform",
    label: "Uniform / Grooming",
    bucket: "operations",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "other",
    operating: true,
    patterns: ["uniform", "apron", "staff dress", "grooming"]
  },
  {
    key: "stationery",
    label: "Stationery / Printing",
    bucket: "admin",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "other",
    operating: true,
    patterns: ["stationery", "printing", "printer paper", "bill book", "office supply"]
  },
  {
    key: "marketing",
    label: "Marketing / Ads / Referral",
    bucket: "sales_marketing",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "marketing",
    operating: true,
    patterns: ["marketing", "ads", "advert", "instagram", "facebook", "google", "campaign", "lead", "influencer", "referral", "banner", "brochure", "signage"]
  },
  {
    key: "software_subscription",
    label: "Software / SMS / WhatsApp",
    bucket: "admin",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "software_subscription",
    operating: true,
    patterns: ["software", "subscription", "sms", "whatsapp", "crm", "pos", "saas", "domain", "hosting"]
  },
  {
    key: "bank_charges",
    label: "Bank / Payment Gateway Charges",
    bucket: "finance_cost",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "bank_charges",
    operating: true,
    patterns: ["bank charges", "payment charge", "gateway", "mdr", "card charge", "upi charge", "fee"]
  },
  {
    key: "professional_legal",
    label: "CA / Legal / License",
    bucket: "admin",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "professional_legal",
    operating: true,
    patterns: ["legal", "license", "licence", "professional", "ca", "audit", "gst filing", "compliance"]
  },
  {
    key: "gst_payment",
    label: "GST / Tax Payment",
    bucket: "tax",
    impact: "Tax payable or input credit is adjusted",
    glCategory: "gst_payment",
    operating: false,
    patterns: ["gst payment", "gst paid", "tax payment", "gst challan", "tax challan"]
  },
  {
    key: "statutory_payment",
    label: "PF / ESI / PT / TDS Payment",
    bucket: "tax",
    impact: "Payroll statutory liability reduces",
    glCategory: "statutory_payment",
    operating: false,
    patterns: ["pf", "esi", "tds", "professional tax", "pt payment", "statutory"]
  },
  {
    key: "security_deposit",
    label: "Security Deposit",
    bucket: "deposit_asset",
    impact: "Deposit asset increases; cash/bank reduces",
    glCategory: "security_deposit",
    operating: false,
    patterns: ["security deposit", "deposit", "rent deposit"]
  },
  {
    key: "prepaid_expense",
    label: "Prepaid Expense",
    bucket: "prepaid_asset",
    impact: "Prepaid asset increases; cash/bank reduces",
    glCategory: "prepaid_expense",
    operating: false,
    patterns: ["prepaid", "advance rent", "annual subscription", "yearly subscription"]
  },
  {
    key: "loan",
    label: "Loan / EMI Principal",
    bucket: "loan",
    impact: "Loan liability reduces; cash/bank reduces",
    glCategory: "loan",
    operating: false,
    patterns: ["loan", "emi", "principal"]
  },
  {
    key: "interest",
    label: "Interest / Finance Cost",
    bucket: "finance_cost",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "other",
    operating: true,
    patterns: ["interest", "finance cost"]
  },
  {
    key: "owner_drawing",
    label: "Owner Drawing",
    bucket: "owner",
    impact: "Owner equity/drawing adjusts; cash/bank reduces",
    glCategory: "owner_drawing",
    operating: false,
    patterns: ["owner drawing", "drawing", "withdrawal", "personal"]
  },
  {
    key: "bank_deposit",
    label: "Bank Deposit / Cash Transfer",
    bucket: "cash_transfer",
    impact: "Cash/bank movement only; no expense",
    glCategory: "bank_deposit",
    operating: false,
    patterns: ["bank depo", "bank deposit", "cash deposit", "cash transfer", "petty cash transfer"]
  },
  {
    key: "travel",
    label: "Travel / Conveyance",
    bucket: "operations",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "other",
    operating: true,
    patterns: ["travel", "travelling", "conveyance", "cab", "auto", "fuel"]
  },
  {
    key: "training",
    label: "Training / Education",
    bucket: "staff",
    impact: "Expense reduces profit/equity; cash/bank reduces",
    glCategory: "other",
    operating: true,
    patterns: ["training", "course", "education", "academy"]
  },
  {
    key: "other",
    label: "Other Salon Outgoing",
    bucket: "review",
    impact: "Review required; default expense impact",
    glCategory: "other",
    operating: true,
    patterns: ["other out", "misc", "daily exp", "expense"]
  }
];

const CATEGORY_BY_KEY = new Map(CATEGORY_DEFINITIONS.map((item) => [item.key, item]));

export const SALON_OUTGOING_CATEGORIES = CATEGORY_DEFINITIONS.map(({ patterns, ...item }) => item);

export function classifySalonOutgoing(type = "", accountName = "", remarks = "") {
  const text = `${type} ${accountName} ${remarks}`.toLowerCase();
  const match = CATEGORY_DEFINITIONS.find((category) =>
    category.patterns.some((pattern) => text.includes(pattern))
  ) || CATEGORY_BY_KEY.get("other");
  return {
    key: match.key,
    label: match.label,
    bucket: match.bucket,
    impact: match.impact,
    glCategory: match.glCategory,
    operating: match.operating
  };
}

export function salonOutgoingCategoryLabel(key = "") {
  return CATEGORY_BY_KEY.get(key)?.label || key || "Other Salon Outgoing";
}

export function salonOutgoingCoverage(lines = []) {
  const used = new Map();
  for (const line of lines) {
    const category = CATEGORY_BY_KEY.get(line.category) || CATEGORY_BY_KEY.get("other");
    const current = used.get(category.key) || { ...category, amountPaise: 0, entries: 0 };
    current.amountPaise += Math.round(Number(line.amountPaise || 0));
    current.entries += 1;
    used.set(category.key, current);
  }
  return {
    categories: [...used.values()].sort((a, b) => b.amountPaise - a.amountPaise),
    missing: SALON_OUTGOING_CATEGORIES.filter((category) => !used.has(category.key))
  };
}
