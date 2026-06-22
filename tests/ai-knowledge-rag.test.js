import test from "node:test";
import assert from "node:assert/strict";

delete process.env.OPENAI_API_KEY;

const { createApp } = await import("../server/app.js");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function headers(role = "owner") {
  return {
    "content-type": "application/json",
    "x-tenant-id": "tenant_aura",
    "x-user-role": role
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return { response, payload: text ? JSON.parse(text) : null };
}

test("AI assistant knowledge workflow returns tenant-scoped cited answer", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const title = `RAG Cancellation Policy ${Date.now()}`;

  try {
    const created = await requestJson(`${baseUrl}/ai/knowledge/documents`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        title,
        category: "policy",
        branchId: "branch_hyd",
        content: "RAG cancellation policy requires six hours notice. Same-day late cancellation needs manager approval."
      })
    });
    assert.equal(created.response.status, 201);

    const run = await requestJson(`${baseUrl}/ai/knowledge-search-summary`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        branchId: "branch_hyd",
        prompt: "What is the RAG cancellation notice rule?"
      })
    });

    assert.equal(run.response.status, 201);
    assert.ok(run.payload.output.sources.includes(title));
    assert.equal(run.payload.output.knowledge.sources.includes(title), true);
    assert.match(run.payload.output.answer, /six hours|cancellation/i);
    assert.ok(run.payload.output.citations.some((citation) => citation.title === title));
    assert.equal(run.payload.output.ai.taskKey, "knowledge.search_summary");

    const deleted = await requestJson(`${baseUrl}/ai/knowledge/documents/${created.payload.document.id}`, {
      method: "DELETE",
      headers: headers()
    });
    assert.equal(deleted.response.status, 200);
  } finally {
    await close(server);
  }
});
