import { saveComplianceReports } from "../services/complianceReports.js";

const allowedFields = [
    "transaction_id",
    "account_id",
    "query_prompt",
    "sql_generated",
    "risk_score",
    "confidence_score",
    "risk_level",
    "action_recommended",
    "sanctions_match",
    "pep_match",
    "vpn_detected",
    "proxy_detected",
    "adverse_media_match",
    "ip_country",
    "transaction_country",
    "exchange_rate",
    "usd_amount",
    "structuring_detected",
    "layering_detected",
    "high_velocity_detected",
    "high_risk_jurisdiction",
    "behavioral_anomaly",
    "ubo_risk",
    "sanctions_source",
    "pep_source",
    "adverse_media_links",
    "flags",
    "compliance_verdict",
    "enrichment_data",
    "aml_rule_results",
    "graph_state",
    "analysed_at"
];

const flattenReport = (report, graphState, analysedAt) => {
    const transaction = report.transaction || {};
    const enrichment = report.enrichment || {};
    const qa = report.qa || {};
    const investigation = report.investigation || {};
    const decision = report.decision || {};
    const enrichmentData = { ...enrichment };

    delete enrichmentData.adverseMediaLinks;

    const flattened = {
        transaction_id: qa.transaction_id ?? transaction.transaction_id ?? null,
        account_id: qa.account_id ?? transaction.account_id ?? null,
        query_prompt: qa.query_prompt ?? graphState.query_prompt ?? "CSV Upload Analysis",
        sql_generated: qa.sql_generated ?? graphState.sql_generated ?? null,
        risk_score: qa.risk_score ?? 0,
        confidence_score: qa.confidence_score ?? 0,
        risk_level: qa.risk_level ?? "LOW",
        action_recommended: decision.action_recommended ?? qa.action_recommended ?? "Monitor",
        sanctions_match: qa.sanctions_match ?? false,
        pep_match: qa.pep_match ?? false,
        vpn_detected: qa.vpn_detected ?? false,
        proxy_detected: qa.proxy_detected ?? false,
        adverse_media_match: qa.adverse_media_match ?? false,
        ip_country: qa.ip_country ?? enrichment.ipCountry ?? null,
        transaction_country: qa.transaction_country ?? enrichment.transactionCountry ?? transaction.country ?? transaction.location ?? null,
        exchange_rate: qa.exchange_rate ?? enrichment.exchangeRate ?? null,
        usd_amount: qa.usd_amount ?? enrichment.usdAmount ?? null,
        structuring_detected: qa.structuring_detected ?? false,
        layering_detected: qa.layering_detected ?? false,
        high_velocity_detected: qa.high_velocity_detected ?? false,
        high_risk_jurisdiction: qa.high_risk_jurisdiction ?? false,
        behavioral_anomaly: qa.behavioral_anomaly ?? false,
        ubo_risk: qa.ubo_risk ?? false,
        sanctions_source: qa.sanctions_source ?? enrichment.sanctionsSource ?? null,
        pep_source: qa.pep_source ?? enrichment.pepSource ?? null,
        adverse_media_links: qa.adverse_media_links ?? enrichment.adverseMediaLinks ?? [],
        flags: qa.flags ?? [],
        compliance_verdict: investigation.compliance_verdict ?? qa.compliance_verdict ?? "",
        enrichment_data: enrichmentData,
        aml_rule_results: qa.aml_rule_results ?? {},
        graph_state: graphState,
        analysed_at: analysedAt
    };

    for (const key of ["id", "created_at", "uploaded_at", "analysis_status", "enrichment"]) {
        delete flattened[key];
    }

    return allowedFields.reduce((accumulator, field) => {
        if (flattened[field] !== undefined) {
            accumulator[field] = flattened[field];
        }
        return accumulator;
    }, {});
};

export async function saveReportsAgent(state) {

    const analysedAt = new Date().toISOString();
    const startedAtMs = state.startedAt ? new Date(state.startedAt).getTime() : Date.now();
    const completedAtMs = new Date(analysedAt).getTime();
    const durationMs = Math.max(0, completedAtMs - startedAtMs);

    const finalMetrics = {
        startedAt: state.startedAt || analysedAt,
        completedAt: analysedAt,
        duration: durationMs,
        nodesExecuted: Array.from(new Set([...(state.graphMetrics?.nodesExecuted || []), "saveNode"])),
        apiCalls: state.graphMetrics?.apiCalls || 0,
        retries: state.graphMetrics?.retries || 0,
        failedApis: state.graphMetrics?.failedApis || []
    };

    const graphState = {
        startedAt: finalMetrics.startedAt,
        completedAt: finalMetrics.completedAt,
        query_prompt: state.query_prompt || "CSV Upload Analysis",
        sql_generated: state.sql_generated ?? null,
        transactionCount: Array.isArray(state.transactions) ? state.transactions.length : 0,
        enrichedTransactionCount: Array.isArray(state.enrichedTransactions) ? state.enrichedTransactions.length : 0,
        reportCount: Array.isArray(state.reports) ? state.reports.length : 0,
        ruleResults: state.ruleResults || [],
        reports: state.reports || [],
        graphMetrics: finalMetrics
    };

    const reports = Array.isArray(state.reports) ? state.reports : [];
    const flattenedReports = reports.map((report) => flattenReport(report, graphState, analysedAt));

    try {
        await saveComplianceReports(flattenedReports, graphState);
    } catch (error) {
        console.error("Compliance report persistence failed for saveReportsAgent:", {
            error: error?.message || error,
            transactionIds: flattenedReports.map((report) => report.transaction_id),
            accountIds: flattenedReports.map((report) => report.account_id)
        });
        return {
            ...state,
            completedAt: analysedAt,
            reportSaveError: error.message,
            graphMetrics: finalMetrics
        };
    }

    console.log("Reports Saved");
    console.log("Graph Finished");
    console.log(`Duration: ${durationMs}ms`);

    return {
        completedAt: analysedAt,
        graphMetrics: finalMetrics
    };

}