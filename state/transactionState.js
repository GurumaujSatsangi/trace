import { Annotation } from "@langchain/langgraph";

export const TransactionState = Annotation.Root({

    // Uploaded transactions from Supabase
    transactions: Annotation(),

    // Transactions after enrichment
    enrichedTransactions: Annotation(),

    // AML Rule Outputs and QA reports
    ruleResults: Annotation(),

    // Final Reports
    reports: Annotation(),

    // Metadata
    startedAt: Annotation(),
    completedAt: Annotation(),

    // Incoming prompt for the current analysis run
    query_prompt: Annotation()

});