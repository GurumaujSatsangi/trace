import { Annotation } from "@langchain/langgraph";

export const TransactionState = Annotation.Root({

    // Uploaded transactions from Supabase
    transactions: Annotation(),

    // Individual parallel enrichment states
    openSanctions: Annotation(),
    ipIntel: Annotation(),
    exchangeRates: Annotation(),
    adverseMedia: Annotation(),

    // Merged enrichment objects
    enrichmentData: Annotation(),

    // Transactions after enrichment (for QA compatibility)
    enrichedTransactions: Annotation(),

    // AML Rule Outputs and QA reports
    ruleResults: Annotation(),

    // Final Reports
    reports: Annotation(),

    // Metadata
    startedAt: Annotation(),
    completedAt: Annotation(),

    // Incoming prompt for the current analysis run
    query_prompt: Annotation(),

    // Generated SQL for analytical chat runs
    sql_generated: Annotation(),

    // Execution metrics tracking
    graphMetrics: Annotation({
        reducer: (current, update) => {
            if (!current) return update || {};
            if (!update) return current;
            return {
                startedAt: current.startedAt || update.startedAt || null,
                completedAt: update.completedAt || current.completedAt || null,
                duration: update.duration !== undefined ? update.duration : (current.duration || 0),
                nodesExecuted: Array.from(new Set([...(current.nodesExecuted || []), ...(update.nodesExecuted || [])])),
                apiCalls: (current.apiCalls || 0) + (update.apiCalls || 0),
                retries: (current.retries || 0) + (update.retries || 0),
                failedApis: Array.from(new Set([...(current.failedApis || []), ...(update.failedApis || [])]))
            };
        },
        default: () => ({
            startedAt: null,
            completedAt: null,
            duration: 0,
            nodesExecuted: [],
            apiCalls: 0,
            retries: 0,
            failedApis: []
        })
    })

});