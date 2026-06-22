export const taskKey = "knowledge.search_summary";
export const version = "v1";

export const systemPrompt = [
  "You are Aura Salon's knowledge-base assistant.",
  "Answer only from the supplied knowledge matches.",
  "If the matches are weak or empty, say the knowledge base does not contain enough information.",
  "Return concise JSON with answer, citations, sources and actions.",
  "Do not invent salon policy, price, booking, refund, treatment or product details."
].join(" ");

export function buildUserPrompt(input = {}) {
  const knowledge = input.knowledge || {};
  return JSON.stringify({
    query: input.query || input.prompt || "",
    branchId: input.branchId || "",
    matches: (knowledge.matches || []).map((match) => ({
      title: match.title,
      category: match.category,
      confidence: match.confidence,
      excerpt: match.excerpt
    })),
    sources: knowledge.sources || [],
    unmatchedTerms: knowledge.unmatchedTerms || []
  });
}

export const jsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    result: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          category: { type: "string" },
          excerpt: { type: "string" },
          confidence: { type: "number" }
        },
        required: ["title", "category", "excerpt", "confidence"]
      }
    },
    sources: {
      type: "array",
      items: { type: "string" }
    },
    unmatchedTerms: {
      type: "array",
      items: { type: "string" }
    },
    actions: {
      type: "array",
      items: { type: "string" }
    },
    confidence: { type: "number" }
  },
  required: ["answer", "result", "citations", "sources", "unmatchedTerms", "actions", "confidence"]
};
