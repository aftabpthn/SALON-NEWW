import { repositories } from "../repositories/repository-registry.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { makeId, now } from "../utils/id.js";
import { securityService } from "./security.service.js";
import { tenantService } from "./tenant.service.js";
import { whatsappAutomationService } from "./whatsapp-automation.service.js";

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text.slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function monthDay(value) {
  const date = normalizeDate(value);
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}-${match[3]}` : "";
}

function daysUntilBirthday(birthday, today = now().slice(0, 10)) {
  const md = monthDay(birthday);
  if (!md) return null;
  const [month, day] = md.split("-").map(Number);
  const base = new Date(`${today}T00:00:00.000Z`);
  let next = new Date(Date.UTC(base.getUTCFullYear(), month - 1, day));
  if (next < base) next = new Date(Date.UTC(base.getUTCFullYear() + 1, month - 1, day));
  return Math.round((next.getTime() - base.getTime()) / 86400000);
}

function normalizePhone(value = "") {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits || digits.length < 7) return "";
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (raw.startsWith("+")) return `+${digits}`;
  return digits.length <= 15 ? `+${digits}` : "";
}

function clientPhone(client = {}) {
  return normalizePhone(client.phone || client.mobile || client.mobileNumber || client.whatsapp || client.whatsappNumber || client.contactNumber);
}

function render(template, client = {}, offer = {}) {
  const name = client.name || "there";
  return String(template || "")
    .replaceAll("{{name}}", name)
    .replaceAll("{{offer}}", offer.title || "birthday glow offer")
    .replaceAll("{{discount}}", offer.discount || "20% off")
    .replaceAll("{{validity}}", offer.validity || "7 days")
    .replaceAll("{{salon}}", "Aura Shine");
}

const MESSAGE_TEMPLATES = [
  "Happy birthday {{name}}! Aura Shine wishes you a beautiful year. Your {{offer}} is ready with {{discount}} for {{validity}}.",
  "Hi {{name}}, birthday glow time! Enjoy {{discount}} on your next salon visit. Valid for {{validity}} at {{salon}}.",
  "Many happy returns, {{name}}. Celebrate with a relaxing {{offer}} and {{discount}} this week.",
  "{{name}}, your birthday treat is waiting. Book your favourite service and unlock {{discount}} for {{validity}}.",
  "Happy birthday {{name}}! Step in for a fresh look and use your special {{offer}} today.",
  "Birthday wishes from {{salon}}, {{name}}. Your exclusive {{discount}} celebration benefit is live now.",
  "Hi {{name}}, make your birthday week special with a pamper session. {{offer}} gives you {{discount}}.",
  "Happy birthday {{name}}. Reply BOOK and our team will reserve your birthday salon slot.",
  "{{name}}, your birthday month deserves a glow-up. Claim {{discount}} on {{offer}} before it expires.",
  "Warm birthday wishes, {{name}}. Visit {{salon}} and enjoy your personal birthday reward."
];

const OFFER_TEMPLATES = [
  { title: "Birthday Glow Facial", discount: "20% off", validity: "7 days", bestFor: "current birthdays" },
  { title: "Hair Spa Birthday Treat", discount: "INR 500 off", validity: "10 days", bestFor: "premium clients" },
  { title: "Nail + Hair Combo", discount: "15% off", validity: "birthday week", bestFor: "combo buyers" },
  { title: "Bring-a-friend Birthday Deal", discount: "buy 1 get 1 add-on", validity: "7 days", bestFor: "referral growth" },
  { title: "Membership Upgrade Gift", discount: "bonus wallet credit", validity: "14 days", bestFor: "loyal clients" },
  { title: "Birthday Makeover Slot", discount: "25% off package", validity: "5 days", bestFor: "upcoming birthdays" },
  { title: "Express Grooming Gift", discount: "free add-on", validity: "7 days", bestFor: "quick visit clients" },
  { title: "Luxury Spa Birthday Pass", discount: "INR 750 off", validity: "10 days", bestFor: "high value clients" },
  { title: "Color Refresh Birthday Offer", discount: "15% off", validity: "birthday month", bestFor: "hair color clients" },
  { title: "Birthday Return Voucher", discount: "10% off next visit", validity: "30 days", bestFor: "retention" }
];

function birthdayStatus(days) {
  if (days === 0) return "today";
  if (days !== null && days <= 7) return "upcoming";
  return "later";
}

export const birthdayCampaignService = {
  summary(query = {}, access = {}) {
    const branchId = query.branchId || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const daysAhead = Math.max(1, Math.min(60, Number(query.daysAhead || 30)));
    const today = normalizeDate(query.date || now().slice(0, 10));
    const clients = repositories.clients
      .list({ branchId, limit: 10000 }, tenantService.accessScope(access, "clients"))
      .map((client) => {
        const days = daysUntilBirthday(client.birthday, today);
        return {
          ...client,
          phone: clientPhone(client),
          daysUntilBirthday: days,
          birthdayStatus: birthdayStatus(days)
        };
      })
      .filter((client) => client.daysUntilBirthday !== null && client.daysUntilBirthday <= daysAhead)
      .sort((a, b) => Number(a.daysUntilBirthday) - Number(b.daysUntilBirthday) || String(a.name).localeCompare(String(b.name)));
    const current = clients.filter((client) => client.daysUntilBirthday === 0);
    const upcoming = clients.filter((client) => Number(client.daysUntilBirthday) > 0);
    return {
      date: today,
      daysAhead,
      metrics: {
        currentBirthdays: current.length,
        upcomingBirthdays: upcoming.length,
        reachableClients: clients.filter((client) => client.phone).length,
        messageSuggestions: MESSAGE_TEMPLATES.length,
        offerSuggestions: OFFER_TEMPLATES.length
      },
      clients,
      current,
      upcoming,
      messageSuggestions: MESSAGE_TEMPLATES.map((template, index) => ({ id: `birthday_msg_${index + 1}`, title: `AI message ${index + 1}`, template })),
      offerSuggestions: OFFER_TEMPLATES.map((offer, index) => ({ id: `birthday_offer_${index + 1}`, ...offer }))
    };
  },

  send(payload = {}, access = {}) {
    const clientId = String(payload.clientId || "").trim();
    if (!clientId) throw badRequest("clientId is required");
    const client = repositories.clients.getById(clientId, tenantService.accessScope(access, "clients"));
    if (!client) throw notFound("Client not found");
    const branchId = client.branchId || payload.branchId || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const phone = clientPhone(client);
    if (!phone) throw badRequest("Client phone or WhatsApp number is missing");
    const offer = OFFER_TEMPLATES.find((item, index) => payload.offerId === `birthday_offer_${index + 1}`) || OFFER_TEMPLATES[0];
    const template = MESSAGE_TEMPLATES.find((item, index) => payload.messageId === `birthday_msg_${index + 1}`) || payload.message || MESSAGE_TEMPLATES[0];
    const message = render(payload.message || template, client, offer);
    const channels = Array.isArray(payload.channels) && payload.channels.length ? payload.channels : ["whatsapp", "sms"];
    const result = { clientId, phone, message, offer, whatsapp: null, sms: null };

    if (channels.includes("whatsapp")) {
      const thread = whatsappAutomationService.ensureThread({ phone, displayName: client.name, client, branchId, source: "birthday-campaign" }, access);
      result.whatsapp = whatsappAutomationService.createOutbound(thread, {
        body: message,
        eventType: "birthday-campaign",
        templateKey: payload.messageId || "birthday_ai_message",
        metadata: { offer, source: "birthday-campaign-page" }
      }, access);
    }

    if (channels.includes("sms")) {
      result.sms = repositories.messageLogs.create({
        branchId,
        clientId,
        channel: "SMS",
        recipient: phone,
        message,
        direction: "outbound",
        status: "queued",
        payload: { offer, source: "birthday-campaign-page", messageId: payload.messageId || "custom" }
      }, tenantService.accessScope(access, "messageLogs"));
    }

    securityService.audit({
      action: "birthday.campaign.sent",
      targetType: "client",
      targetId: clientId,
      details: { branchId, channels, phone, offer: offer.title }
    }, access);
    return result;
  },

  sendBulk(payload = {}, access = {}) {
    const summary = this.summary({ daysAhead: payload.daysAhead || 30, branchId: payload.branchId || "" }, access);
    const mode = String(payload.mode || "all").toLowerCase();
    const pool = mode === "today" ? summary.current : mode === "upcoming" ? summary.upcoming : summary.clients;
    const limit = Math.max(1, Math.min(500, Number(payload.limit || 100)));
    const clients = pool.filter((client) => client.phone).slice(0, limit);
    const results = clients.map((client) => {
      try {
        return { ok: true, clientId: client.id, result: this.send({ ...payload, clientId: client.id }, access) };
      } catch (error) {
        return { ok: false, clientId: client.id, error: error.message };
      }
    });
    securityService.audit({
      action: "birthday.campaign.bulk_sent",
      targetType: "birthday_campaign",
      targetId: makeId("bdblk"),
      details: { mode, requested: pool.length, attempted: clients.length, sent: results.filter((row) => row.ok).length }
    }, access);
    return { mode, requested: pool.length, attempted: clients.length, sent: results.filter((row) => row.ok).length, failed: results.filter((row) => !row.ok).length, results };
  }
};



