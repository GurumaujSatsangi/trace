import { saveComplianceReports } from "../services/complianceReports.js";

export async function saveReportsAgent(state) {

    const analysedAt = new Date().toISOString();
    const graphState = {
        startedAt: state.startedAt || null,
        completedAt: analysedAt,
        query_prompt: state.query_prompt || "CSV Upload Analysis",
        transactionCount: Array.isArray(state.transactions) ? state.transactions.length : 0,
        enrichedTransactionCount: Array.isArray(state.enrichedTransactions) ? state.enrichedTransactions.length : 0,
        reportCount: Array.isArray(state.reports) ? state.reports.length : 0,
        ruleResults: state.ruleResults || [],
        reports: state.reports || []
    };

    try {
        await saveComplianceReports(state.reports, graphState);
    } catch (error) {
        console.error("Compliance report persistence failed for saveReportsAgent:", {
            error: error?.message || error,
            transactionIds: (state.reports || []).map((report) => report.transaction_id),
            accountIds: (state.reports || []).map((report) => report.account_id)
        });
        return {
            ...state,
            completedAt: analysedAt,
            reportSaveError: error.message
        };
    }

    return {
        ...state,
        completedAt: analysedAt
    };

}