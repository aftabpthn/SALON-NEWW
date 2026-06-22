import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const growthRoutes = readFileSync("server/routes/growth-rank-bot.routes.js", "utf8");
const growthService = readFileSync("server/services/growth-rank-bot.service.js", "utf8");
const growthPage = readFileSync("src/app/pages/growth-rank-bot.component.ts", "utf8");
const appRoutes = readFileSync("src/app/app.routes.ts", "utf8");
const appComponent = readFileSync("src/app/app.component.ts", "utf8");

test("Growth digital marketing exposes command center and approval workflow APIs", () => {
  assert.match(growthRoutes, /\/growth-rank-bot\/command-center/, "Growth command center route should exist");
  assert.match(growthRoutes, /\/growth-rank-bot\/approval-workflow\/:type\/:id\/status/, "Approval workflow status route should exist");
  assert.match(growthService, /commandCenter\(query = \{\}, access = \{\}\)/, "Service should derive command center");
  assert.match(growthService, /growthRecommendationQueue\(board = \{\}\)/, "Recommendation queue should be derived from live rows");
  assert.match(growthService, /growthApprovalWorkflow\(board = \{\}\)/, "Approval workflow should combine content, planner and proposal rows");
  assert.match(growthService, /growthCampaignRoi\(board = \{\}\)/, "Campaign ROI summary should be available");
  assert.match(growthService, /growthSocialLeadTracking\(board = \{\}\)/, "Social lead tracking should be available");
  assert.match(growthService, /updateApprovalWorkflowItem\(type, id, payload = \{\}, access = \{\}\)/, "Approval workflow action should be available");
});

test("Growth page renders campaign ROI, recommendation queue, approvals and social lead tracking", () => {
  assert.match(growthPage, /Growth command center/, "UI should show the command center panel");
  assert.match(growthPage, /growth-rank-bot\/command-center/, "UI should load the command center endpoint");
  assert.match(growthPage, /growth-rank-bot\/approval-workflow\/\$\{item\.type\}\/\$\{item\.id\}\/status/, "UI should approve workflow rows");
  assert.match(growthPage, /Growth recommendation queue/, "UI should render recommendation queue");
  assert.match(growthPage, /Approval workflow/, "UI should render approval workflow");
  assert.match(growthPage, /Campaign ROI/, "UI should render campaign ROI");
  assert.match(growthPage, /Social lead tracking/, "UI should render social lead tracking");
  assert.match(growthPage, /Weak keywords/, "UI should render SEO/rank bot status");
});

test("Growth marketing remains reachable from routes and sidebar", () => {
  assert.match(appRoutes, /path: 'growth-rank-bot'/, "Growth Rank Bot route should exist");
  assert.match(appRoutes, /path: 'marketing'/, "AI marketing route should exist");
  assert.match(appComponent, /path: '\/growth-rank-bot'/, "Growth Rank Bot should be in navigation");
  assert.match(appComponent, /path: '\/marketing'/, "Marketing automation should be in navigation");
});
