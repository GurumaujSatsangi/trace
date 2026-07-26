/**
 * Query Planner — produces a structured execution plan from resolved context.
 * Does NOT execute anything. Returns { path, entities, filters, tools, directResponse }.
 * index.js runs the actual tools via executeQueryPlan().
 */

const GREETING_RESPONSE = "Hi! I can help analyse transactions, customers, risk flags, suspicious patterns, and AML activity. What would you like to investigate?";
const OUT_OF_SCOPE_RESPONSE = "I'm focused on TRACE's AML and transaction-analysis workflows. I can help with transaction risk, customer activity, suspicious patterns, structuring, filtering, and compliance findings.";

/**
 * Build a structured execution plan from a resolved context request.
 * @param {object} resolvedRequest - Output from contextResolver
 * @returns {object} plan
 */
export function buildQueryPlan(resolvedRequest) {
    const { intent, entities, filters, resolvedQuery, originalMessage, needsClarification, clarificationQuestion } = resolvedRequest;

    // Clarification needed
    if (needsClarification) {
        return {
            path: "clarification",
            entities,
            filters,
            tools: [],
            directResponse: clarificationQuestion || "Could you clarify which entity you're referring to?",
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // Greeting
    if (intent === "greeting") {
        return {
            path: "direct_response",
            entities,
            filters,
            tools: [],
            directResponse: GREETING_RESPONSE,
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // Out of scope
    if (intent === "out_of_scope") {
        return {
            path: "direct_response",
            entities,
            filters,
            tools: [],
            directResponse: OUT_OF_SCOPE_RESPONSE,
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // Null / genuinely unclear intent → ask for clarification
    if (intent === null || intent === undefined) {
        return {
            path: "clarification",
            entities,
            filters,
            tools: [],
            directResponse: "I wasn't sure what you meant. Could you rephrase your question? I can help with transaction risk lookups, customer analysis, structuring patterns, and other AML-related queries.",
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // Transaction risk lookup / explanation
    if (intent === "transaction_risk_lookup" || intent === "transaction_risk_explanation") {
        const tools = ["transaction_lookup", "risk_lookup"];
        return {
            path: "deterministic_lookup",
            entities,
            filters,
            tools,
            directResponse: null,
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // Transaction lookup (details only, no risk focus)
    if (intent === "transaction_lookup") {
        return {
            path: "deterministic_lookup",
            entities,
            filters,
            tools: ["transaction_lookup"],
            directResponse: null,
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // Customer risk lookup
    if (intent === "customer_risk_lookup") {
        return {
            path: "deterministic_lookup",
            entities,
            filters,
            tools: ["customer_lookup", "risk_lookup"],
            directResponse: null,
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // Customer transaction history
    if (intent === "customer_transaction_history") {
        return {
            path: "deterministic_lookup",
            entities,
            filters,
            tools: ["customer_lookup"],
            directResponse: null,
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // Structuring detection
    if (intent === "structuring_detection") {
        const tools = ["date_resolver", "transaction_filter", "structuring_detector"];
        return {
            path: "structuring_detection",
            entities,
            filters,
            tools,
            directResponse: null,
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // Layering detection — uses existing single-tx layering rule via risk_lookup
    if (intent === "layering_detection") {
        return {
            path: "risk_pattern_search",
            entities,
            filters,
            tools: ["date_resolver", "transaction_filter", "risk_lookup"],
            directResponse: null,
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // Threshold aggregation (e.g. "customers with 10+ transactions under $1000")
    if (intent === "threshold_aggregation") {
        return {
            path: "aggregate_filter",
            entities,
            filters,
            tools: ["sql_aggregate"],
            directResponse: null,
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // High risk listing
    if (intent === "high_risk_listing") {
        return {
            path: "aggregate_filter",
            entities,
            filters,
            tools: ["sql_aggregate"],
            directResponse: null,
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // Broad EDA
    if (intent === "broad_eda") {
        return {
            path: "broad_eda",
            entities,
            filters,
            tools: ["schema_summary", "sql_aggregate"],
            directResponse: null,
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // General dataset question — controlled SQL fallback
    if (intent === "general_dataset_question") {
        return {
            path: "sql_fallback",
            entities,
            filters,
            tools: ["sql_generate", "sql_validate", "sql_execute"],
            directResponse: null,
            resolvedQuery,
            originalMessage,
            intent
        };
    }

    // Fallback for any unrecognized intent string — treat as general question
    return {
        path: "sql_fallback",
        entities,
        filters,
        tools: ["sql_generate", "sql_validate", "sql_execute"],
        directResponse: null,
        resolvedQuery,
        originalMessage,
        intent
    };
}
