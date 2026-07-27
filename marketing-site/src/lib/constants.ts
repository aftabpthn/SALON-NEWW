import type { NavLink, Feature, PricingTier, Testimonial, BlogPost, FeaturePageData } from "./types";

/* ===== NAVIGATION ===== */
export const NAV_LINKS: NavLink[] = [
  { label: "Platform", href: "/platform" },
  { label: "Owner CRM", href: "/owner-crm" },
  { label: "Customer App", href: "/customer-app" },
  { label: "Staff App", href: "/staff-app" },
  { label: "Workflows", href: "/workflows" },
  { label: "Pricing", href: "/pricing" },
];

export const CTA_LINKS = {
  login: "/demo",
  trial: "/demo",
  demo: "/demo",
};

/* ===== FEATURES ===== */
export const FEATURES: Feature[] = [
  {
    icon: "calendar",
    title: "Smart Booking",
    description: "Slot guidance, online booking, waitlist management and QR check-ins.",
    href: "/features/appointments",
    color: "#681F37",
  },
  {
    icon: "credit-card",
    title: "POS & Billing",
    description: "GST-ready invoicing, split payments (UPI/card/cash/wallet), thermal printing, and daily closing.",
    href: "/features/billing",
    color: "#B87343",
  },
  {
    icon: "users",
    title: "Customer 360",
    description: "Client profiles, purchase history, loyalty, wallet, WhatsApp history and follow-up context.",
    href: "/features/client-crm",
    color: "#526D68",
  },
  {
    icon: "user-check",
    title: "Staff OS",
    description: "Attendance (face/biometric), shift scheduling, commissions, payroll, and performance dashboards.",
    href: "/features/staff-management",
    color: "#567565",
  },
  {
    icon: "package",
    title: "Inventory Brain",
    description: "Batch tracking, FIFO, expiry alerts, usage-based reorder guidance, suppliers and waste records.",
    href: "/features/inventory",
    color: "#9B7445",
  },
  {
    icon: "megaphone",
    title: "Marketing Workflows",
    description: "Birthday campaigns, WhatsApp sequences, SMS campaigns, lead follow-up and performance tracking.",
    href: "/features/marketing-ai",
    color: "#A44D5E",
  },
  {
    icon: "trending-up",
    title: "Finance Engine",
    description: "Daily closing, cash drawer, expenses, balance sheet, profit intelligence, and GST reports.",
    href: "/features/finance",
    color: "#8A5C3F",
  },
  {
    icon: "shield-check",
    title: "Compliance",
    description: "PF, ESI, TDS, professional tax, gratuity and bonus calculation and record workflows.",
    href: "/features/compliance",
    color: "#4F3D4C",
  },
];

export const FEATURES_OVERVIEW: Feature[] = [
  ...FEATURES,
  {
    icon: "palette",
    title: "White Label",
    description: "Custom branding, domain, logo for multi-location salon chains and franchises.",
    href: "/features/white-label",
    color: "#916B79",
  },
];

/* ===== LANDING PAGE STATS ===== */
export const STATS = [
  { value: 10000, suffix: "+", label: "Appointments Booked" },
  { value: 500, suffix: "+", label: "Salons Trust Aura" },
  { value: 50, suffix: "Cr+", prefix: "₹", label: "Transactions Processed" },
  { value: 99.9, suffix: "%", label: "Uptime Guarantee" },
];

/* ===== HOW IT WORKS ===== */
export const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Sign Up in 2 Minutes",
    description: "Create your salon account, set up your branch, and you're ready. No complex setup required.",
  },
  {
    step: 2,
    title: "Import Your Data",
    description: "Bring existing client, service and staff records through a guided setup and migration process.",
  },
  {
    step: 3,
    title: "Start Running Your Salon",
    description: "Manage appointments, billing, staff, inventory, and marketing — all from one dashboard.",
  },
];

/* ===== PRICING ===== */
export const PRICING_TIERS: PricingTier[] = [
  {
    name: "Starter",
    monthlyPrice: 999,
    yearlyPrice: 799,
    description: "Perfect for single-salon owners getting started",
    features: [
      "1 Branch",
      "Unlimited Appointments",
      "POS & Billing (GST)",
      "Client CRM",
      "Basic Reports",
      "Online Booking Portal",
      "WhatsApp Notifications",
      "Email Support",
    ],
    cta: "Start Free Trial",
  },
  {
    name: "Growth",
    monthlyPrice: 2499,
    yearlyPrice: 1999,
    description: "For growing salons that need automation and intelligence",
    features: [
      "Up to 5 Branches",
      "Everything in Starter",
      "Staff OS (Attendance, Payroll)",
      "Inventory Management",
      "Marketing Campaign Workflows",
      "Finance Engine",
      "Customer 360 Intelligence",
      "Discount Rules (Happy Hours)",
      "Priority Support",
      "API Access",
    ],
    highlighted: true,
    cta: "Start Free Trial",
  },
  {
    name: "Enterprise",
    monthlyPrice: 0,
    yearlyPrice: 0,
    description: "Custom solutions for large salon chains and franchises",
    features: [
      "Unlimited Branches",
      "Everything in Growth",
      "White Label Branding",
      "Custom Domain & Logo",
      "Compliance (PF/ESI/TDS)",
      "Franchise Management",
      "Digital Twin Simulator",
      "Dedicated Account Manager",
      "Custom Integrations",
      "SLA Guarantee",
    ],
    cta: "Contact Sales",
  },
];

export const PRICING_FAQ = [
  {
    question: "Is there a free trial?",
    answer: "Yes! Every plan comes with a 14-day free trial. No credit card required. You get full access to all features in your chosen plan.",
  },
  {
    question: "Can I switch plans later?",
    answer: "Absolutely. You can upgrade or downgrade your plan at any time. Changes take effect immediately, and we'll prorate the difference.",
  },
  {
    question: "How does multi-branch pricing work?",
    answer: "Starter plan is for single branches. Growth plan supports up to 5 branches. Enterprise plan has unlimited branches with custom pricing.",
  },
  {
    question: "Do you offer annual discounts?",
    answer: "Yes! Annual billing saves you 20% compared to monthly billing. That's 2 months free every year.",
  },
  {
    question: "What payment methods do you accept?",
    answer: "We accept UPI, credit/debit cards, net banking, and bank transfers. All payments are processed through Razorpay with bank-grade security.",
  },
  {
    question: "Is my data secure?",
    answer: "Absolutely. We use enterprise-grade encryption, regular backups, and SOC 2 compliant infrastructure. Your data is always yours.",
  },
];

/* ===== TESTIMONIALS ===== */
export const TESTIMONIALS: Testimonial[] = [
  {
    quote: "Aura transformed how we run our salon. We went from managing everything on paper to having a complete digital system in just one week. Our revenue increased by 40% in the first quarter.",
    name: "Priya Sharma",
    role: "Owner",
    salon: "Glow Studio",
    city: "Mumbai",
    rating: 5,
  },
  {
    quote: "The staff management module is a game-changer. Attendance tracking, payroll, commissions — everything automated. We save 15 hours every week on admin tasks.",
    name: "Rahul Mehta",
    role: "Director",
    salon: "The Style Lounge",
    city: "Delhi",
    rating: 5,
  },
  {
    quote: "Customer 360 is incredible. I know every client's history, preferences, and spending patterns. The AI recommendations help us upsell naturally without being pushy.",
    name: "Anjali Kapoor",
    role: "Manager",
    salon: "Bloom Beauty Bar",
    city: "Bangalore",
    rating: 5,
  },
  {
    quote: "We switched from Fresha to Aura and never looked back. The Indian GST billing, UPI payments, and WhatsApp integration make it perfect for Indian salons.",
    name: "Vikram Singh",
    role: "Owner",
    salon: "Royal Men's Grooming",
    city: "Jaipur",
    rating: 5,
  },
  {
    quote: "The marketing automation alone pays for the subscription. Birthday campaigns, follow-up messages, and re-engagement — all running on autopilot.",
    name: "Meera Nair",
    role: "Owner",
    salon: "Serenity Spa",
    city: "Kochi",
    rating: 5,
  },
  {
    quote: "Managing 12 branches was chaos before Aura. Now I have a single dashboard with real-time data from every location. The multi-branch analytics are phenomenal.",
    name: "Arjun Patel",
    role: "CEO",
    salon: "StyleCraft Chain",
    city: "Ahmedabad",
    rating: 5,
  },
];

/* ===== BLOG POSTS ===== */
export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "how-to-increase-salon-revenue",
    title: "7 Proven Strategies to Increase Your Salon Revenue in 2025",
    excerpt: "Discover actionable techniques that top-performing salons use to boost revenue by 30-50% through smart pricing, upselling, and client retention.",
    date: "2025-07-15",
    readTime: "8 min read",
    category: "Business Growth",
  },
  {
    slug: "salon-staff-management-guide",
    title: "The Complete Guide to Salon Staff Management",
    excerpt: "From attendance tracking to performance-based commissions — learn how leading salons manage their teams efficiently with technology.",
    date: "2025-07-10",
    readTime: "12 min read",
    category: "Staff Management",
  },
  {
    slug: "digital-transformation-salon",
    title: "Why Your Salon Needs Digital Transformation Now",
    excerpt: "The salon industry is evolving rapidly. Here's why going digital isn't optional anymore and how to make the transition smooth.",
    date: "2025-07-05",
    readTime: "6 min read",
    category: "Industry Insights",
  },
  {
    slug: "gst-billing-salon-guide",
    title: "GST Billing for Salons: Everything You Need to Know",
    excerpt: "A complete guide to GST compliance for salon businesses — from invoicing to filing returns with practical examples.",
    date: "2025-06-28",
    readTime: "10 min read",
    category: "Compliance",
  },
  {
    slug: "salon-marketing-automation",
    title: "How to Set Up Automated Marketing for Your Salon",
    excerpt: "Build practical birthday, re-engagement and WhatsApp follow-up workflows with clear timing and consent.",
    date: "2025-06-20",
    readTime: "9 min read",
    category: "Marketing",
  },
  {
    slug: "salon-inventory-management",
    title: "Stop Losing Money on Inventory: A Salon Owner's Guide",
    excerpt: "Use batch, expiry, service-recipe and reorder records to make stock decisions with better context.",
    date: "2025-06-15",
    readTime: "7 min read",
    category: "Operations",
  },
];

/* ===== FEATURE PAGES DATA ===== */
export const FEATURE_PAGES: Record<string, FeaturePageData> = {
  appointments: {
    translationKey: "appointments",
    title: "Smart Booking & Appointments",
    subtitle: "Practical scheduling, waitlists and booking controls for a busy salon day",
    icon: "calendar",
    gradient: "from-aura-burgundy to-aura-rose",
    capabilities: [
      { title: "Working Calendar", description: "Day, week and month views with rescheduling, walk-ins and multi-staff context." },
      { title: "Online Booking Portal", description: "A public pay-at-salon booking flow with service and professional selection." },
      { title: "Slot Guidance", description: "Use staff availability, service duration and salon capacity to suggest practical slots." },
      { title: "Waitlist & QR Check-in", description: "Keep waitlist requests beside the calendar and support QR check-in for walk-ins." },
    ],
    stats: [
      { value: "Calendar", label: "Staff-aware" },
      { value: "Waitlist", label: "Status flow" },
      { value: "Branch", label: "Scoped" },
    ],
  },
  billing: {
    translationKey: "billing",
    title: "POS & Billing",
    subtitle: "GST-ready invoicing, split payments, thermal printing and daily closing",
    icon: "credit-card",
    gradient: "from-aura-amber to-aura-burgundy",
    capabilities: [
      { title: "GST-Ready Invoicing", description: "GST calculation, HSN/SAC context and invoice records with thermal printer support." },
      { title: "Split Payments", description: "Accept UPI, cards, cash, wallet, and gift card payments in any combination on a single invoice." },
      { title: "Daily Closing & Z-Report", description: "End-of-day reconciliation with cash drawer records and variance tracking." },
      { title: "Invoice Management", description: "Hold, void, refund, and track every invoice with complete audit trails and event history." },
    ],
    stats: [
      { value: "GST", label: "Invoice records" },
      { value: "Split", label: "Payment options" },
      { value: "Audit", label: "Event history" },
    ],
  },
  "client-crm": {
    translationKey: "client-crm",
    title: "Customer 360 Intelligence",
    subtitle: "Keep visit history, preferences, wallet and follow-up context together",
    icon: "users",
    gradient: "from-electric-blue to-aura-burgundy",
    capabilities: [
      { title: "Complete Client Profiles", description: "Visit history, purchase patterns, preferences, notes, tags, consent forms, and WhatsApp communication." },
      { title: "Value & Follow-up Context", description: "Use formulas and configured rules for LTV, risk context and suggested follow-up." },
      { title: "Loyalty & Wallet", description: "Points-based loyalty programs, digital wallet, credit notes, and store credits." },
      { title: "Client Memory", description: "Keep preferences, allergies, product reactions and visit context attached to the client record." },
    ],
    stats: [
      { value: "History", label: "Visit context" },
      { value: "Wallet", label: "Credit records" },
      { value: "Consent", label: "Client controls" },
    ],
  },
  "staff-management": {
    translationKey: "staff-management",
    title: "Staff OS",
    subtitle: "Attendance, roster, commission and payroll records with owner policy controls",
    icon: "user-check",
    gradient: "from-aura-success to-electric-blue",
    capabilities: [
      { title: "Attendance Controls", description: "Face, biometric and manual records; secure Staff App attendance is Android-only when policy enables it." },
      { title: "Commission Rules", description: "Set attribution rules for services, products and memberships with permission-gated staff views." },
      { title: "Payroll Records", description: "Bring attendance, commission, deductions and payroll exports into one review flow." },
      { title: "Performance Context", description: "Review targets, contribution and permitted performance measures without inventing coaching claims." },
    ],
    stats: [
      { value: "Roster", label: "Shift context" },
      { value: "Policy", label: "Attendance" },
      { value: "Payroll", label: "Review flow" },
    ],
  },
  inventory: {
    translationKey: "inventory",
    title: "Inventory Brain",
    subtitle: "Track batches, expiry, service usage and reorder context without relying on guesswork",
    icon: "package",
    gradient: "from-aura-amber to-aura-burgundy",
    capabilities: [
      { title: "Batch & FIFO Tracking", description: "Batch-wise inventory with first-in-first-out costing, expiry tracking, and wastage analysis." },
      { title: "Reorder Guidance", description: "Review historical usage, lead time, seasonality and upcoming booking context before ordering." },
      { title: "Supplier Management", description: "Keep vendor profiles, purchase bills and procurement records together." },
      { title: "Service Recipes", description: "Link products to services for automatic consumption tracking and cost analysis per service." },
    ],
    stats: [
      { value: "Batch", label: "Expiry context" },
      { value: "Recipe", label: "Service usage" },
      { value: "Reorder", label: "Review" },
    ],
  },
  "marketing-ai": {
    translationKey: "marketing-ai",
    title: "Marketing Workflows",
    subtitle: "Plan birthday, follow-up and re-engagement campaigns with clear rules and templates",
    icon: "megaphone",
    gradient: "from-aura-burgundy to-aura-rose",
    capabilities: [
      { title: "Birthday & Festival Campaigns", description: "Use templates and rules for birthday messages, festival campaigns and seasonal offers." },
      { title: "WhatsApp Workflows", description: "Prepare booking confirmations, reminders, follow-ups and payment reminders for WhatsApp." },
      { title: "Lead Management", description: "Track enquiries and planned follow-up from first contact to conversion." },
      { title: "Content Assistance", description: "Draft captions and campaign copy through a configured provider, with local fallback where available." },
    ],
    stats: [
      { value: "Rules", label: "Audience timing" },
      { value: "Templates", label: "Message workflow" },
      { value: "Provider", label: "Disclosed" },
    ],
  },
  finance: {
    translationKey: "finance",
    title: "Finance Engine",
    subtitle: "Daily closing, ledger context and profitability review for the owner",
    icon: "trending-up",
    gradient: "from-aura-amber to-aura-burgundy",
    capabilities: [
      { title: "Daily Closing", description: "Review cash drawer, expenses, payments and variance at the end of the day." },
      { title: "Balance Sheet & Ledger", description: "Full double-entry bookkeeping with journal entries, auto-grouped ledger, and balance sheet." },
      { title: "Profit Intelligence", description: "Formula-based margin, cost-centre and profitability context for owner review." },
      { title: "GST & Tax Reports", description: "Prepare GST calculation and reporting data with TDS tracking; filing stays outside this claim." },
    ],
    stats: [
      { value: "Closing", label: "Daily review" },
      { value: "Ledger", label: "Source linked" },
      { value: "Reports", label: "Branch scoped" },
    ],
  },
  compliance: {
    translationKey: "compliance",
    title: "Statutory Compliance",
    subtitle: "Calculation, records and reminders for PF, ESI, TDS and professional tax workflows",
    icon: "shield-check",
    gradient: "from-deep-navy to-aura-burgundy",
    capabilities: [
      { title: "PF & ESI Records", description: "Support calculation, deduction and payroll records for owner or professional review." },
      { title: "TDS Section 192", description: "Support salary TDS computation, declarations, proofs and Form 16 workflow records." },
      { title: "Professional Tax", description: "Keep state-based professional tax calculation and deduction context." },
      { title: "Compliance Calendar", description: "Track due dates, reminders and review status in one place." },
    ],
    stats: [
      { value: "Calculate", label: "Payroll context" },
      { value: "Record", label: "Review trail" },
      { value: "Remind", label: "Due dates" },
    ],
  },
  "white-label": {
    translationKey: "white-label",
    title: "White Label SaaS",
    subtitle: "Your brand, your domain, your rules — run Aura under your own identity",
    icon: "palette",
    gradient: "from-aura-burgundy to-aura-rose",
    capabilities: [
      { title: "Custom Branding", description: "Your logo, colors, fonts, and brand identity throughout the entire platform." },
      { title: "Custom Domain", description: "Run your salon portal on your own domain — e.g., booking.yoursalon.com." },
      { title: "Multi-Tenant Architecture", description: "Complete data isolation between tenants with shared infrastructure efficiency." },
      { title: "Multi-Location Identity", description: "Keep approved branding and location context consistent across authorised branches." },
    ],
    stats: [
      { value: "Brand", label: "Your identity" },
      { value: "Custom", label: "Domain & Logo" },
      { value: "Tenant", label: "Isolated" },
    ],
  },
};

/* ===== INTEGRATIONS ===== */
export const INTEGRATIONS = [
  { name: "WhatsApp Business", description: "Automated messaging" },
  { name: "Razorpay", description: "Payment processing" },
  { name: "Google Reviews", description: "Reputation management" },
  { name: "Tally", description: "Accounting sync" },
  { name: "SMS Gateway", description: "Bulk messaging" },
  { name: "Thermal Printers", description: "Invoice printing" },
];

/* ===== FOOTER LINKS ===== */
export const FOOTER_LINKS = {
  product: [
    { label: "Platform", href: "/platform" },
    { label: "Owner CRM", href: "/owner-crm" },
    { label: "Customer App", href: "/customer-app" },
    { label: "Staff App", href: "/staff-app" },
    { label: "Workflows", href: "/workflows" },
    { label: "Pricing", href: "/pricing" },
  ],
  company: [
    { label: "About Us", href: "/about" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "/contact" },
    { label: "Careers", href: "/about" },
  ],
  resources: [
    { label: "FAQ", href: "/faq" },
    { label: "Documentation", href: "/blog" },
    { label: "Help Center", href: "/contact" },
    { label: "Status Page", href: "/contact" },
    { label: "API Reference", href: "/features" },
  ],
  legal: [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" },
    { label: "Cookie Policy", href: "/cookies" },
  ],
};
