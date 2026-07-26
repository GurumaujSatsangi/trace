/**
 * Response Formatter — formats grounded, medium-length responses and
 * provides intent-aware empty-state/error messages.
 *
 * Responsible for:
 * - Building the final analysis prompt with both original + resolved queries
 * - Enforcing 80–160 word target for single entity questions
 * - Intent-specific no-result messages
 */

import { SystemMessage, HumanMessage } from "@langchain/core/messages";

/**
 * Generate a grounded analysis response using the LLM.
 *
 * @param {object} params
 * @param {string} params.originalMessage - The user's verbatim message
 * @param {string} params.resolvedQuery - The resolved self-contained query
 * @param {string} params.intent - The resolved intent
 * @param {object} params.evidence - The data/results retrieved from tools
 * @param {object} params.model - ChatOpenAI instance
 * @returns {Promise<string>} formatted response
 */
export async function formatGroundedResponse({ originalMessage, resolvedQuery, intent, evidence, model }) {
    const evidenceStr = JSON.stringify(
        evidence,
        (key, value) => typeof value === "bigint" ? value.toString() : value,
        2
    );

    const systemPrompt = `You are TRACE, an expert Anti-Money Laundering (AML) compliance officer.

Current User Message: "${originalMessage}"
Resolved Request: "${resolvedQuery}"

Retrieved Data (current evidence from the active dataset):
${evidenceStr}

CRITICAL RULES:
- Use conversation context only to understand the request.
- Use ONLY the current retrieved/computed TRACE data above as the source of AML factual claims.
- Never treat previous assistant messages as factual evidence.
- Do NOT invent facts not present in the retrieved data.
- Do NOT use asterisks (**) for bold formatting.
- Do NOT assert sanctions matches, PEP status, or adverse media findings unless the current data explicitly shows them as true.
- A near-threshold transaction amount is an INDICATOR, not proof of money laundering or structuring.

Response guidelines:
- Target 80 to 160 words when the evidence warrants it.
- Structure: a direct verdict, then 2-4 strongest relevant reasons as bullet points, then one short interpretation sentence, then a recommended action.
- If the user asks for a list, table, or specific records, output the data in a clear HTML table (<table>, <thead>, <tbody>, <tr>, <th>, <td>) or an HTML list (<ul>/<li>) BEFORE your analysis. Do NOT use markdown tables.
- Do NOT repeat the verdict multiple times.
- Return sources from news screening and PEP only when the current data shows them as relevant.`;

    try {
        const response = await model.invoke([
            new SystemMessage(systemPrompt),
            new HumanMessage("Evaluate the retrieved data and provide your analysis.")
        ]);

        return String(response.content || "").replace(/\*\*/g, "");
    } catch (err) {
        console.error("responseFormatter: LLM call failed:", err.message);
        return "I encountered an error generating the analysis. The retrieved data is available but could not be summarized.";
    }
}

/**
 * Generate intent-aware no-result / error messages.
 *
 * @param {object} params
 * @param {string} params.intent
 * @param {object} params.entities
 * @param {object} params.filters
 * @param {object} params.dateFilter - resolved date filter or null
 * @param {string} params.context - additional context about what happened
 * @returns {string}
 */
export function formatNoResultMessage({ intent, entities, filters, dateFilter, context }) {
    // Missing specific entity
    if (entities?.transaction_id && (context === "not_found" || context === "empty_results")) {
        return `I couldn't find transaction ${entities.transaction_id} in the active dataset.`;
    }

    if (entities?.account_id && (context === "not_found" || context === "empty_results")) {
        return `I couldn't find account ${entities.account_id} in the active dataset.`;
    }

    if (entities?.customer_name && (context === "not_found" || context === "empty_results")) {
        return `I couldn't find customer "${entities.customer_name}" in the active dataset.`;
    }

    // Structuring with no candidates
    if (intent === "structuring_detection" && context === "no_candidates") {
        const rangeInfo = dateFilter
            ? ` in the period ${dateFilter.start} to ${dateFilter.end}`
            : "";
        return `I found transactions${rangeInfo}, but none met the configured structuring-pattern criteria.`;
    }

    // No transactions in date range
    if (context === "empty_date_range" && dateFilter) {
        return `The resolved date range (${dateFilter.start} to ${dateFilter.end}) contains no transactions in the active dataset.`;
    }

    // Filter removes all rows
    if (context === "filter_empty" && filters) {
        const activeFilters = Object.entries(filters)
            .filter(([_, v]) => v)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
        return `No transactions matched the applied filters (${activeFilters}) in the active dataset.`;
    }

    // Layering with no results
    if (intent === "layering_detection" && context === "no_candidates") {
        return "I found transactions in the requested scope, but none exhibit the configured layering indicators (cross-border transfers/wires with different beneficiaries).";
    }

    // Generic fallback — but still no "check your spelling"
    return "No matching data was found in the active dataset for this query.";
}

/**
 * Validate that SQL is read-only (no mutating statements).
 * @param {string} sql
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateReadOnlySql(sql) {
    if (!sql || typeof sql !== "string") {
        return { valid: false, error: "No SQL statement provided." };
    }

    const normalized = sql.trim().toUpperCase();
    const forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "COPY", "ATTACH"];

    for (const keyword of forbidden) {
        // Check if the statement starts with or contains the keyword as a statement
        const regex = new RegExp(`(^|;\\s*)${keyword}\\b`, "i");
        if (regex.test(normalized)) {
            return { valid: false, error: `SQL contains a forbidden ${keyword} statement. Only SELECT queries are allowed.` };
        }
    }

    return { valid: true };
}
