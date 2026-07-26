import { SystemMessage, HumanMessage } from "@langchain/core/messages";

/**
 * Resolves conversational context and intent from the current message
 * and recent chat history. Returns a structured request for downstream
 * query planning — never generates AML facts.
 *
 * @param {{ message: string, history: Array<{role:string, content:string}>, model: object }} params
 * @returns {Promise<object>} resolvedRequest
 */
export async function resolveContext({ message, history, model }) {
    const hasHistory = Array.isArray(history) && history.length > 0;

    const systemPrompt = `You are the intent and context resolver for TRACE, an Anti-Money Laundering compliance system.

Given:
1. Recent conversation history (user and assistant messages) — may be empty on first turn.
2. The current user message.

Your job is to determine what the current message refers to and return structured JSON.

Rules:
- ALWAYS extract intent, entities, and filters — even if there is no conversation history.
- Explicit entities or filters in the CURRENT message always override anything from history.
- Inherit previous entities/filters ONLY when the current message is a follow-up that omits necessary context (e.g. "Why?", "What action should we take?", "Only show high-risk ones.").
- When inheriting filters, preserve filters from history that the current message does NOT explicitly change. For example if history has dateExpression="last 30 days" and the user says "Only high-risk ones", keep the dateExpression and add riskLevel=HIGH. But if the user says "What about the previous 7 days?", override dateExpression while keeping other inherited filters.
- Do NOT invent transaction IDs, customer IDs, account IDs, filters, AML findings, dates, or risk values that are not present in either the current message or the conversation history.
- If the current message references a single entity from a prior response that discussed MULTIPLE entities and the reference is ambiguous (e.g. "it", "that one"), set needsClarification to true and provide a clarificationQuestion listing the possible entities.
- Conversation text is context for understanding intent, NOT evidence of AML facts. Never treat a previous assistant response as proof of a compliance finding.
- If the current message is a standalone question with no relation to history, just resolve it directly with inheritedContext: false.

Intent classification — use one of:
- "greeting" — greetings like hi, hello, hey, good morning, etc. Also map VERY short or vague inputs like "ok", "yes", "no" to greeting if no AML context exists.
- "out_of_scope" — requests unrelated to AML/transaction analysis (e.g. write code, recipes, essays, general knowledge)
- "transaction_risk_lookup" — check risk level/status of a specific transaction
- "transaction_risk_explanation" — explain why a transaction has its risk classification
- "customer_risk_lookup" — check risk of a specific customer/account
- "structuring_detection" — find structuring patterns
- "layering_detection" — find layering patterns
- "threshold_aggregation" — aggregate queries with conditions (e.g. "customers with 10+ transactions under $1000")
- "high_risk_listing" — list high-risk transactions/customers
- "transaction_lookup" — look up a specific transaction's details
- "customer_transaction_history" — get transaction history for a customer/account
- "broad_eda" — broad exploratory analysis of the dataset (e.g. "analyse this dataset for suspicious activity")
- "general_dataset_question" — a valid AML/transaction question that doesn't fit other intents
- null — ONLY when genuinely unclear and ambiguous. Do not use null for valid AML questions.

IMPORTANT: Short contextual follow-ups like "Why?", "Only high-risk ones", "What action should we take?" are IN SCOPE when recent history supplies AML/transaction context. Do NOT classify them as out_of_scope.

Return ONLY valid JSON with this exact schema (no markdown, no explanation):
{
  "originalMessage": "<the current user message verbatim>",
  "resolvedQuery": "<a complete, self-contained rephrasing of what the user is asking, incorporating any inherited context>",
  "intent": "<one of the intents listed above, or null if genuinely unclear>",
  "entities": {
    "transaction_id": "<if applicable, else omit>",
    "customer_id": "<if applicable, else omit>",
    "account_id": "<if applicable, else omit>",
    "customer_name": "<if applicable, else omit>"
  },
  "filters": {
    "riskLevel": "<if applicable, e.g. HIGH, MEDIUM, LOW>",
    "dateExpression": "<if applicable, e.g. 'last 30 days'>",
    "amlPattern": "<if applicable, e.g. 'structuring', 'layering'>",
    "amountThreshold": "<if applicable, e.g. '$1000'>",
    "countThreshold": "<if applicable, e.g. '10'>"
  },
  "inheritedContext": <true if context was inherited from history, false otherwise>,
  "needsClarification": <true if the reference is ambiguous>,
  "clarificationQuestion": "<question to ask the user if ambiguous, else null>"
}`;

    // Build the conversation context for the LLM
    let userPrompt;
    if (hasHistory) {
        const historyText = history
            .map(h => `${h.role === "user" ? "User" : "TRACE"}: ${h.content}`)
            .join("\n");

        userPrompt = `Conversation history:
${historyText}

Current user message: "${message}"

Resolve the current message in context and return the structured JSON.`;
    } else {
        userPrompt = `No conversation history (this is the first message in this conversation).

Current user message: "${message}"

Extract the intent, entities, and filters from this standalone message and return the structured JSON.`;
    }

    try {
        const response = await model.invoke([
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt)
        ]);

        const rawContent = String(response.content || "").trim();

        // Strip potential markdown code fences
        const jsonString = rawContent
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "");

        const parsed = JSON.parse(jsonString);

        // Validate essential fields
        return {
            originalMessage: parsed.originalMessage || message,
            resolvedQuery: parsed.resolvedQuery || message,
            intent: parsed.intent || null,
            entities: parsed.entities && typeof parsed.entities === "object" ? parsed.entities : {},
            filters: parsed.filters && typeof parsed.filters === "object" ? parsed.filters : {},
            inheritedContext: Boolean(parsed.inheritedContext),
            needsClarification: Boolean(parsed.needsClarification),
            clarificationQuestion: parsed.clarificationQuestion || null
        };
    } catch (err) {
        console.error("Context resolver failed, falling back to standalone query:", err.message);

        // Safe fallback: treat as standalone
        return {
            originalMessage: message,
            resolvedQuery: message,
            intent: null,
            entities: {},
            filters: {},
            inheritedContext: false,
            needsClarification: false,
            clarificationQuestion: null
        };
    }
}
