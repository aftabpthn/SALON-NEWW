import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("server/app.js", "utf8");
const routes = readFileSync("server/routes/reputation.routes.js", "utf8");
const reputationService = readFileSync("server/services/reputation/reputation.service.js", "utf8");
const feedbackIntelligenceService = readFileSync("server/services/reputation/feedback-intelligence.service.js", "utf8");
const requester = readFileSync("server/services/reputation/review-requester.service.js", "utf8");
const providerSync = readFileSync("server/services/reputation/provider-sync.service.js", "utf8");
const billingController = readFileSync("server/controllers/billing.controller.js", "utf8");
const salonOperations = readFileSync("server/services/salon-operations.service.js", "utf8");
const reputationRoutes = readFileSync("src/app/features/reputation/reputation.routes.ts", "utf8");
const reputationApi = readFileSync("src/app/features/reputation/data-access/reputation-api.service.ts", "utf8");
const commandCenterPage = readFileSync("src/app/features/reputation/pages/reputation-command-center.page.ts", "utf8");
const reputationModels = readFileSync("src/app/features/reputation/domain/reputation.models.ts", "utf8");
const publicPage = readFileSync("src/app/features/reputation/pages/public-feedback.page.ts", "utf8");
const reportsPage = readFileSync("src/app/pages/reports.component.ts", "utf8");

test("public review request APIs are mounted before authenticated reputation routes", () => {
  assert.match(routes, /export const reputationPublicRouter = Router\(\)/, "public reputation router should exist");
  assert.match(routes, /\/reputation\/public\/requests\/:id/, "public request lookup route should exist");
  assert.match(routes, /\/reputation\/public\/requests\/:id\/feedback/, "public feedback submit route should exist");
  assert.ok(
    app.indexOf('app.use("/api/v1", reputationPublicRouter)') < app.indexOf('app.use("/api/v1", authenticateJwt(), auditLogMiddleware)'),
    "v1 public review route should be mounted before auth middleware"
  );
  assert.ok(
    app.indexOf('app.use("/api", reputationPublicRouter)') < app.indexOf('app.use("/api", legacyApiAuth)'),
    "legacy public review route should be mounted before legacy auth middleware"
  );
});

test("invoice and POS checkout queue review requests with invoice context", () => {
  assert.match(billingController, /reputationService\.sendReviewRequest\(appointmentId,\s*\{ invoiceId: invoice\.id,\s*force: true,\s*channel: "auto" \}/, "billing finalize should queue review request");
  assert.match(salonOperations, /reputationService\.sendReviewRequest\(appointmentId,\s*\{ invoiceId: paidInvoice\.id,\s*force: true,\s*channel: "auto" \}/, "POS checkout should queue review request");
  assert.match(requester, /feedback_link:\s*`\/reputation\/internal-feedback\?\$\{query\.toString\(\)\}`/, "review request message should include customer feedback page link");
  assert.match(requester, /if \(invoiceId\) query\.set\("invoiceId", invoiceId\)/, "review link should carry invoice id when available");
});

test("public feedback submission creates live reputation review rows linked to client profile", () => {
  assert.match(reputationService, /publicReviewRequest\(requestId\)/, "reputation service should expose public request lookup");
  assert.match(reputationService, /submitPublicFeedback\(requestId,\s*payload/, "reputation service should expose public feedback submit");
  assert.match(requester, /submitPublicFeedback\(id,\s*payload/, "requester should implement public feedback submit");
  assert.match(requester, /this\.internalFeedback\(\{[\s\S]*customerId: request\.customerId[\s\S]*appointmentId: request\.appointmentId[\s\S]*invoiceId:/, "public feedback should preserve customer, appointment and invoice context");
  assert.match(requester, /UPDATE review_requests_sent[\s\S]*review_submitted = 1[\s\S]*submitted_review_id/, "submitted request should be marked with review id");
  assert.match(requester, /INSERT INTO reviews_v2[\s\S]*customer_id[\s\S]*appointment_id[\s\S]*invoice_id/, "feedback should create reviews_v2 row visible in reputation and client filters");
});

test("Angular reputation feedback page opens from invoice review link and posts public feedback", () => {
  assert.match(reputationRoutes, /path:\s*'internal-feedback'[\s\S]*PublicFeedbackPage/, "reputation route should expose public feedback page");
  assert.match(publicPage, /queryParamMap\.get\('requestId'\)/, "page should read request id from review link");
  assert.match(publicPage, /queryParamMap\.get\('invoiceId'\)/, "page should preserve invoice id from review link");
  assert.match(publicPage, /reputation\/public\/requests\/\$\{encodeURIComponent\(this\.requestId\)\}/, "page should load public request context");
  assert.match(publicPage, /feedback'[\s\S]*invoiceId: this\.invoiceId/, "page should submit feedback with invoice id");
});

test("Reputation command center exposes a visible send review link option", () => {
  assert.match(reputationApi, /sendReviewRequest\(appointmentId: string/, "reputation API should expose manual review request sender");
  assert.match(commandCenterPage, /Send invoice review link/, "command center should show review link panel");
  assert.match(commandCenterPage, /\[\(ngModel\)\]="reviewAppointmentId"/, "review link panel should accept appointment id");
  assert.match(commandCenterPage, /\[\(ngModel\)\]="reviewInvoiceId"/, "review link panel should accept invoice id");
  assert.match(commandCenterPage, /sendReviewLink\(\)/, "review link panel should call sendReviewLink");
  assert.match(commandCenterPage, /reputationApi\.sendReviewRequest/, "sendReviewLink should call backend review request API");
});

test("Platform setup drawer accepts and displays provider listing details", () => {
  assert.match(reputationModels, /businessListingId: string/, "review platform model should include listing id");
  assert.match(reputationModels, /platformUrl: string/, "review platform model should include platform url");
  assert.match(reputationApi, /connectPlatform\(code: string,\s*branchId: string,\s*payload: ApiRecord = \{\}/, "connect API should accept provider payload");
  assert.match(commandCenterPage, /\[\(ngModel\)\]="platformBusinessListingId"/, "drawer should capture business listing id");
  assert.match(commandCenterPage, /\[\(ngModel\)\]="platformBusinessListingUrl"/, "drawer should capture listing url");
  assert.match(commandCenterPage, /\[\(ngModel\)\]="platformUrl"/, "drawer should capture platform url");
  assert.match(commandCenterPage, /\[\(ngModel\)\]="platformTokenEnvKey"/, "drawer should capture provider credential env key");
  assert.match(commandCenterPage, /\[\(ngModel\)\]="platformPageAccountId"/, "drawer should capture page or Instagram account id");
  assert.match(commandCenterPage, /businessListingId: this\.platformBusinessListingId\.trim\(\)/, "connect should send listing id");
  assert.match(commandCenterPage, /tokenEnvKey: this\.platformTokenEnvKey\.trim\(\)/, "connect should send provider credential reference");
  assert.match(reputationService, /providerConfigFromPayload\(platformCode,\s*payload\)/, "backend should store provider config from setup drawer");
  assert.match(reputationService, /credentialMode:\s*"env_reference"/, "backend should prefer env-referenced credentials over raw secrets");
  assert.match(commandCenterPage, /ID: \{\{ platform\.businessListingId \}\}/, "platform card should show saved listing id");
  assert.match(commandCenterPage, /platform\.providerStatus/, "platform card should show provider credential status");
  assert.match(commandCenterPage, /Instagram business account ID \/ Facebook page ID/, "Instagram setup should explain which id to paste");
});

test("Reputation platform sync uses live provider adapters when credentials are configured", () => {
  assert.match(reputationService, /syncReputationPlatform\(platform,\s*access,\s*payload\)/, "syncPlatform should delegate to provider adapter");
  assert.match(routes, /asyncHandler\(async \(req,\s*res\)[\s\S]*await reputationService\.syncPlatform/, "sync route should await async provider sync");
  assert.match(providerSync, /META_GRAPH_ACCESS_TOKEN/, "Instagram adapter should read Meta Graph token env");
  assert.match(providerSync, /GOOGLE_BUSINESS_PROFILE_ACCESS_TOKEN/, "Google adapter should read Google Business Profile token env");
  assert.match(providerSync, /YELP_API_KEY/, "Yelp adapter should read Yelp API key env");
  assert.match(providerSync, /comments\.limit[\s\S]*graph\.facebook\.com/, "Instagram sync should import media comments");
  assert.match(providerSync, /mybusiness\.googleapis\.com\/v4\/accounts/, "Google sync should call Business Profile reviews API");
  assert.match(providerSync, /api\.yelp\.com\/v3\/businesses/, "Yelp sync should call Yelp reviews API");
  assert.match(providerSync, /INSERT INTO reviews_v2[\s\S]*platform_review_id/, "provider sync should persist imported review rows");
});

test("Reputation command center exposes live feed, negative alerts and approval-ready AI reply drafts", () => {
  assert.match(commandCenterPage, /Live feed[\s\S]*Recent reviews/, "command center should show recent review live feed");
  assert.match(commandCenterPage, /Urgent[\s\S]*Alerts/, "command center should show negative review alert area");
  assert.match(commandCenterPage, /AI reply draft[\s\S]*Approval queue/, "command center should show AI reply draft approval panel");
  assert.match(commandCenterPage, /\[\(ngModel\)\]="replyDraftReviewId"/, "AI reply panel should select a live review");
  assert.match(commandCenterPage, /draftReply\(\)/, "AI reply panel should request drafts");
  assert.match(commandCenterPage, /saveDraftReply\(draft\)/, "AI reply panel should save selected draft for approval");
  assert.match(reputationApi, /draftReplies\(id: string,\s*payload: ApiRecord\)/, "Angular API should call draft reply endpoint");
  assert.match(reputationApi, /createReply\(id: string,\s*payload: ApiRecord\)/, "Angular API should save approval replies");
  assert.match(reputationService, /buildReplyDrafts\(review,\s*payload\)/, "backend should create local rule-based reply drafts");
  assert.match(reputationService, /providerStatus:\s*"local_rule_draft"/, "backend should report deterministic local draft status");
  assert.match(reputationService, /pendingReplyCount\(query,\s*access\)/, "dashboard should include pending approval state");
});

test("Customer feedback intelligence report reuses reputation stack with recovery actions", () => {
  assert.match(routes, /feedbackIntelligenceService/, "reputation routes should import feedback intelligence service");
  assert.match(routes, /\/reports\/customer-feedback"/, "customer feedback report endpoint should exist");
  assert.match(routes, /\/reports\/customer-feedback\/staff-score/, "staff score endpoint should exist");
  assert.match(routes, /\/reports\/customer-feedback\/service-score/, "service score endpoint should exist");
  assert.match(routes, /send-recovery-message/, "manual recovery message endpoint should exist");
  assert.match(routes, /mark-reviewed/, "manual reviewed endpoint should exist");
  assert.match(feedbackIntelligenceService, /reputationService\.reviews/, "report should reuse reputation reviews as source of truth");
  assert.match(feedbackIntelligenceService, /RATING_BUCKETS/, "report should calculate rating buckets");
  assert.match(feedbackIntelligenceService, /buildStaffScore/, "report should calculate staff feedback score");
  assert.match(feedbackIntelligenceService, /buildServiceScore/, "report should calculate service feedback score");
  assert.match(feedbackIntelligenceService, /reputationService\.createReply/, "recovery message should reuse reply workflow");
  assert.match(feedbackIntelligenceService, /reputationService\.resolveReview/, "mark reviewed should reuse resolve workflow");
  assert.match(reputationApi, /customerFeedbackReport/, "Angular reputation API should fetch customer feedback report");
  assert.match(reputationApi, /sendFeedbackRecoveryMessage/, "Angular reputation API should expose recovery action");
  assert.match(commandCenterPage, /Feedback Report/, "command center should include feedback tab");
  assert.match(commandCenterPage, /Rating Intelligence/, "command center should include rating intelligence tab");
  assert.match(commandCenterPage, /Negative Review Recovery/, "command center should include negative recovery tab");
  assert.match(commandCenterPage, /Staff Feedback Score/, "command center should include staff score tab");
  assert.match(commandCenterPage, /feedbackNumber\('veryPoor'\)/, "UI should show very poor bucket");
  assert.match(reportsPage, /Customer Feedback/, "reports command center should link customer feedback");
  assert.match(reportsPage, /queryParams: \{ tab: 'feedback' \}/, "reports link should open feedback tab");
});
