import { repositories } from "../repositories/repository-registry.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { tenantService } from "./tenant.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

function scope(access, branchId = "") {
  const scoped = tenantService.accessScope(access || {}, "");
  if (branchId) scoped.branchId = branchId;
  return scoped;
}

function daysSince(value) {
  if (!value) return 999;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 999;
  return Math.max(0, Math.round((Date.now() - time) / 86400000));
}

function titleCase(value) {
  return String(value || "").replace(/\b\w/g, (char) => char.toUpperCase());
}

function sum(items, selector) {
  return items.reduce((total, item) => total + Number(selector(item) || 0), 0);
}

const CONTACT_MASKED_ROLES = new Set(["marketingLead", "customMarketingLead"]);

function maskPhone(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

function maskEmail(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const [name = "", domain = ""] = text.split("@");
  if (!domain) return "***";
  return `${name.slice(0, 1) || "*"}***@${domain}`;
}

function maskClientContacts(row, access = {}) {
  if (!CONTACT_MASKED_ROLES.has(String(access.role || access.userRole || ""))) return row;
  const next = { ...row, contactMasked: true };
  for (const key of ["phone", "mobile", "clientPhone", "customerPhone"]) {
    if (next[key] !== undefined) next[key] = maskPhone(next[key]);
  }
  for (const key of ["email", "clientEmail", "customerEmail"]) {
    if (next[key] !== undefined) next[key] = maskEmail(next[key]);
  }
  return next;
}

export class AiMarketingService {
  context(input = {}, access) {
    tenantService.ensureSubscriptionActive(access.tenantId);
    const branchId = input.branchId || access.requestedBranchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const queryScope = scope(access, branchId);
    const branchQuery = branchId ? { branchId, limit: 10000 } : { limit: 10000 };
    return {
      access,
      branchId,
      branches: repositories.branches.list(branchQuery, queryScope),
      clients: repositories.clients.list(branchQuery, queryScope),
      services: repositories.services.list({ limit: 10000 }, scope(access)),
      products: repositories.products.list(branchQuery, queryScope),
      memberships: repositories.memberships.list(branchQuery, queryScope),
      campaigns: repositories.campaigns.list({ limit: 10000 }, scope(access)),
      workflows: repositories.marketingWorkflows.list(branchQuery, queryScope),
      sequences: repositories.marketingSequences.list(branchQuery, queryScope),
      emailTemplates: repositories.emailTemplates.list(branchQuery, queryScope),
      generations: repositories.aiMarketingGenerations.list({ limit: 20 }, scope(access))
    };
  }

  summary(query = {}, access) {
    const context = this.context(query, access);
    const segments = this.segmentDefinitions(context);
    return {
      metrics: {
        campaigns: context.campaigns.length,
        activeWorkflows: context.workflows.filter((item) => item.status === "active").length,
        whatsappSequences: context.sequences.filter((item) => item.channel.toLowerCase() === "whatsapp").length,
        emailTemplates: context.emailTemplates.length,
        generatedIdeas: context.generations.length,
        estimatedAudience: segments.reduce((total, segment) => total + segment.count, 0)
      },
      segments,
      campaigns: context.campaigns,
      workflows: context.workflows,
      sequences: context.sequences,
      emailTemplates: context.emailTemplates,
      generations: context.generations,
      recommendations: this.offerRecommendationsFrom(context)
    };
  }

  generateCampaign(payload = {}, access) {
    const context = this.context(payload, access);
    const segment = this.segment(payload.segment || payload, access);
    const occasion = payload.occasion || payload.festival || "growth";
    const channel = payload.channel || "WhatsApp";
    const offer = this.bestOffer(payload, context, segment.clients);
    const name = payload.name || `${titleCase(occasion)} ${segment.name} campaign`;
    const template = this.templateFor({ occasion, channel, offer, segmentName: segment.name });
    const campaign = repositories.campaigns.create({
      id: makeId("camp"),
      name,
      channel,
      segmentRule: payload.segment || payload,
      template,
      status: payload.status || "draft",
      scheduledAt: payload.scheduledAt || "",
      sentCount: 0,
      conversionValue: 0
    }, scope(access, context.branchId));
    const generation = this.persistGeneration("campaign", payload, context, {
      campaign,
      segment: { name: segment.name, count: segment.count },
      offer,
      caption: this.captionText({ occasion, offer, channel }),
      actions: ["campaign-created", "review-copy", "schedule-send"]
    });
    return { campaign, generation, segment, offer };
  }

  generateCaption(payload = {}, access) {
    const context = this.context(payload, access);
    const offer = this.bestOffer(payload, context, context.clients);
    const output = {
      channel: payload.channel || "Instagram",
      caption: this.captionText({ occasion: payload.occasion || "salon glow", offer, channel: payload.channel || "Instagram" }),
      hashtags: ["#SalonCare", "#GlowUp", "#HairAndSkin", "#AuraSalon", `#${titleCase(payload.occasion || "Beauty").replaceAll(" ", "")}`],
      callToAction: "Book now on WhatsApp or online."
    };
    const generation = this.persistGeneration("caption", payload, context, output);
    return { generation, output };
  }

  recommendOffers(payload = {}, access) {
    const context = this.context(payload, access);
    const segment = this.segment(payload.segment || payload, access);
    const offers = this.offerRecommendationsFrom(context, segment.clients).slice(0, 8);
    const generation = this.persistGeneration("offer-recommendations", payload, context, { segment: { name: segment.name, count: segment.count }, offers });
    return { generation, segment, offers };
  }

  segment(input = {}, access) {
    const context = this.context(input, access);
    const tag = String(input.tag || "").toLowerCase();
    const minSpend = Number(input.minSpend || 0);
    const minVisits = Number(input.minVisits || 0);
    const inactiveDays = Number(input.inactiveDays || 0);
    const membershipOnly = Boolean(input.membershipOnly);
    const highValue = Boolean(input.highValue);
    const clients = context.clients.filter((client) => {
      const tagMatch = tag ? (client.tags || []).map((item) => String(item).toLowerCase()).includes(tag) : true;
      const spendMatch = Number(client.totalSpend || 0) >= minSpend && (!highValue || Number(client.totalSpend || 0) >= 20000);
      const visitMatch = Number(client.visitCount || 0) >= minVisits;
      const inactiveMatch = inactiveDays ? daysSince(client.lastVisitAt) >= inactiveDays : true;
      const membershipMatch = membershipOnly ? Boolean(client.membershipId) : true;
      return tagMatch && spendMatch && visitMatch && inactiveMatch && membershipMatch;
    });
    return {
      name: input.name || this.segmentName({ tag, minSpend, minVisits, inactiveDays, membershipOnly, highValue }),
      count: clients.length,
      clients: clients.map((client) => maskClientContacts(client, access))
    };
  }

  createRetargetingWorkflow(payload = {}, access) {
    const context = this.context(payload, access);
    const segment = this.segment({ inactiveDays: payload.inactiveDays || 30, highValue: payload.highValue || false }, access);
    const workflow = repositories.marketingWorkflows.create({
      id: makeId("mw"),
      branchId: context.branchId,
      name: payload.name || `Retarget ${segment.name}`,
      trigger: payload.trigger || "client.inactive",
      channel: payload.channel || "WhatsApp",
      status: payload.status || "active",
      triggerRule: payload.triggerRule || { inactiveDays: payload.inactiveDays || 30, segment: segment.name },
      steps: payload.steps || this.retargetingSteps(payload.channel || "WhatsApp"),
      metrics: { enrolled: segment.count, conversions: 0, revenue: 0 }
    }, scope(access, context.branchId));
    const generation = this.persistGeneration("retargeting-workflow", payload, context, { workflow, segment: { name: segment.name, count: segment.count } });
    return { workflow, generation, segment };
  }

  createWhatsAppSequence(payload = {}, access) {
    const context = this.context(payload, access);
    const segment = this.segment(payload.audienceRule || payload, access);
    const sequence = repositories.marketingSequences.create({
      id: makeId("seq"),
      branchId: context.branchId,
      name: payload.name || `${segment.name} WhatsApp sequence`,
      channel: "WhatsApp",
      campaignId: payload.campaignId || "",
      audienceRule: payload.audienceRule || payload,
      steps: payload.steps || [
        { day: 0, body: "Hi {{name}}, your personalised Aura offer is ready: {{offer}}." },
        { day: 2, body: "A quick reminder, {{name}}. Reply 1 and we will help you book." },
        { day: 5, body: "Last chance this week for your salon offer at Aura." }
      ],
      status: payload.status || "draft",
      metrics: { audience: segment.count, sent: 0, replies: 0, booked: 0 }
    }, scope(access, context.branchId));
    const generation = this.persistGeneration("whatsapp-sequence", payload, context, { sequence, segment: { name: segment.name, count: segment.count } });
    return { sequence, generation, segment };
  }

  createEmailTemplate(payload = {}, access) {
    const context = this.context(payload, access);
    const occasion = payload.occasion || "festival";
    const offer = this.bestOffer(payload, context, context.clients);
    const template = repositories.emailTemplates.create({
      id: makeId("email"),
      branchId: context.branchId,
      name: payload.name || `${titleCase(occasion)} email template`,
      subject: payload.subject || `${titleCase(occasion)} salon offer for {{name}}`,
      body: payload.body || `Hi {{name}}, ${offer.title}. ${offer.description} Book your slot with Aura Salon today.`,
      purpose: payload.purpose || `${occasion}-campaign`,
      variables: payload.variables || ["name", "offer", "bookingLink"],
      status: payload.status || "active"
    }, scope(access, context.branchId));
    const generation = this.persistGeneration("email-template", payload, context, { template, offer });
    return { template, generation };
  }

  festivalCampaign(payload = {}, access) {
    const festival = payload.festival || "Festive Glow";
    const campaignResult = this.generateCampaign({
      ...payload,
      occasion: festival,
      channel: payload.channel || "WhatsApp",
      segment: payload.segment || { minSpend: 0, minVisits: 1 },
      name: payload.name || `${festival} salon growth campaign`
    }, access);
    const email = this.createEmailTemplate({ ...payload, occasion: festival, purpose: "festival-campaign" }, access);
    const sequence = this.createWhatsAppSequence({ ...payload, name: `${festival} WhatsApp booking sequence`, audienceRule: payload.segment || { minVisits: 1 }, campaignId: campaignResult.campaign.id }, access);
    return { campaign: campaignResult.campaign, emailTemplate: email.template, sequence: sequence.sequence, generation: campaignResult.generation };
  }

  persistGeneration(type, input, context, output) {
    return repositories.aiMarketingGenerations.create({
      id: makeId("aimkt"),
      branchId: context.branchId,
      type,
      campaignId: output.campaign?.id || output.sequence?.campaignId || "",
      input,
      segment: output.segment || {},
      output,
      actions: output.actions || [],
      status: "generated"
    }, scope(context.access, context.branchId));
  }

  segmentDefinitions(context) {
    const vip = context.clients.filter((client) => (client.tags || []).map((tag) => String(tag).toLowerCase()).includes("vip"));
    const inactive = context.clients.filter((client) => daysSince(client.lastVisitAt) >= 45);
    const highSpend = context.clients.filter((client) => Number(client.totalSpend || 0) >= 20000);
    const membership = context.clients.filter((client) => Boolean(client.membershipId));
    return [
      { name: "VIP clients", count: vip.length, rule: { tag: "VIP" }, estimatedValue: money(sum(vip, (client) => client.totalSpend) * 0.08) },
      { name: "Inactive win-back", count: inactive.length, rule: { inactiveDays: 45 }, estimatedValue: money(inactive.length * 1800) },
      { name: "High spenders", count: highSpend.length, rule: { minSpend: 20000 }, estimatedValue: money(sum(highSpend, (client) => client.totalSpend) * 0.06) },
      { name: "Members", count: membership.length, rule: { membershipOnly: true }, estimatedValue: money(membership.length * 2500) }
    ];
  }

  offerRecommendationsFrom(context, clients = context.clients) {
    const topService = [...context.services].sort((a, b) => Number(b.price || 0) - Number(a.price || 0))[0];
    const lowStockRetail = context.products.filter((product) => product.usageType === "retail" && Number(product.stock || 0) > 0).slice(0, 3);
    const inactiveCount = clients.filter((client) => daysSince(client.lastVisitAt) >= 45).length;
    return [
      {
        title: `${topService?.name || "Signature service"} upgrade`,
        description: "Bundle a premium service with a small add-on to lift average ticket size.",
        audience: "high spenders",
        estimatedRevenue: money(clients.length * Number(topService?.price || 1800) * 0.18)
      },
      {
        title: "Inactive client comeback credit",
        description: "Give a time-bound service credit to clients who have not visited recently.",
        audience: "inactive clients",
        estimatedRevenue: money(inactiveCount * 2200)
      },
      ...lowStockRetail.map((product) => ({
        title: `${product.name} aftercare bundle`,
        description: "Attach retail aftercare to recent service buyers before stock ages.",
        audience: "recent visitors",
        estimatedRevenue: money(Number(product.stock || 0) * Number(product.price || 0) * 0.45)
      }))
    ];
  }

  bestOffer(payload, context, clients) {
    const offers = this.offerRecommendationsFrom(context, clients);
    const preferred = payload.offerTitle ? offers.find((offer) => offer.title.toLowerCase().includes(String(payload.offerTitle).toLowerCase())) : null;
    return preferred || offers[0] || { title: "Personalized salon offer", description: "Curated service and retail bundle.", estimatedRevenue: 0 };
  }

  templateFor({ occasion, channel, offer, segmentName }) {
    const intro = channel === "Email" ? "Hi {{name}}," : "Hi {{name}},";
    return `${intro} ${titleCase(occasion)} special for ${segmentName}: ${offer.title}. ${offer.description} Reply 1 to book.`;
  }

  captionText({ occasion, offer, channel }) {
    const platform = channel || "Instagram";
    return `${titleCase(occasion)} ready at Aura Salon. ${offer.title}: ${offer.description} DM or WhatsApp us to book your slot. ${platform === "WhatsApp" ? "Reply 1 to book." : "Limited slots this week."}`;
  }

  segmentName({ tag, minSpend, minVisits, inactiveDays, membershipOnly, highValue }) {
    if (tag) return `${titleCase(tag)} clients`;
    if (inactiveDays) return `Inactive ${inactiveDays}+ day clients`;
    if (membershipOnly) return "Membership clients";
    if (highValue || minSpend >= 20000) return "High value clients";
    if (minVisits) return `${minVisits}+ visit clients`;
    return "All clients";
  }

  retargetingSteps(channel) {
    if (String(channel).toLowerCase() === "email") {
      return [
        { day: 0, subject: "We saved a salon offer for you", body: "Hi {{name}}, your personalised Aura Salon offer is ready." },
        { day: 4, subject: "A little reminder from Aura", body: "Your offer is still valid this week." },
        { day: 9, subject: "Last chance this week", body: "Book before the offer window closes." }
      ];
    }
    return [
      { day: 0, body: "Hi {{name}}, we miss you at Aura. Your comeback offer is ready." },
      { day: 3, body: "Reply 1 and our front desk will help you book your offer." },
      { day: 7, body: "Last reminder: your Aura comeback offer expires soon." }
    ];
  }
}

export const aiMarketingService = new AiMarketingService();
