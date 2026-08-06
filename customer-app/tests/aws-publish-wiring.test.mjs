import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("AWS deploy publishes the Customer App without deleting the CRM SPA", () => {
  const workflow = read(".github/workflows/deploy-aws.yml");
  const edge = read("infra/aws/terraform/edge.tf");

  assert.match(workflow, /working-directory: customer-app[\s\S]*npm run build -- --base-href \/customer\//);
  assert.match(workflow, /s3:\/\/\$BUCKET\/customer\/.*--delete/);
  assert.match(workflow, /--exclude "customer\/\*"/);
  assert.match(workflow, /curl.*"\$URL\/customer\/"/);
  assert.match(edge, /uri === "\/customer"[\s\S]*request\.uri = "\/customer\/index\.html"/);
});
