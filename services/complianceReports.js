import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const tableColumns = [
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

const normalizeReport = (report, graphState, analysedAt) => {
    const normalized = {
        transaction_id: report.transaction_id ?? null,
        account_id: report.account_id ?? null,
        query_prompt: report.query_prompt ?? graphState.query_prompt ?? "CSV Upload Analysis",
        sql_generated: report.sql_generated ?? graphState.sql_generated ?? null,
        risk_score: Number(report.risk_score ?? 0),
        confidence_score: Number(report.confidence_score ?? 0),
        risk_level: report.risk_level ?? "LOW",
        action_recommended: report.action_recommended ?? "Monitor",
        sanctions_match: Boolean(report.sanctions_match),
        pep_match: Boolean(report.pep_match),
        vpn_detected: Boolean(report.vpn_detected),
        proxy_detected: Boolean(report.proxy_detected),
        adverse_media_match: Boolean(report.adverse_media_match),
        ip_country: report.ip_country ?? null,
        transaction_country: report.transaction_country ?? null,
        exchange_rate: report.exchange_rate ?? null,
        usd_amount: report.usd_amount ?? null,
        structuring_detected: Boolean(report.structuring_detected),
        layering_detected: Boolean(report.layering_detected),
        high_velocity_detected: Boolean(report.high_velocity_detected),
        high_risk_jurisdiction: Boolean(report.high_risk_jurisdiction),
        behavioral_anomaly: Boolean(report.behavioral_anomaly),
        ubo_risk: Boolean(report.ubo_risk),
        sanctions_source: report.sanctions_source ?? null,
        pep_source: report.pep_source ?? null,
        adverse_media_links: Array.isArray(report.adverse_media_links) ? report.adverse_media_links : [],
        flags: Array.isArray(report.flags) ? report.flags : [],
        compliance_verdict: report.compliance_verdict ?? "",
        enrichment_data: report.enrichment_data ?? {},
        aml_rule_results: report.aml_rule_results ?? {},
        graph_state: report.graph_state ?? graphState,
        analysed_at: report.analysed_at ?? analysedAt
    };

    const cleaned = {};

    for (const column of tableColumns) {
        if (normalized[column] !== undefined) {
            cleaned[column] = normalized[column];
        }
    }

    return cleaned;
};

export async function saveComplianceReports(reports, graphState = {}) {

    if (!Array.isArray(reports) || reports.length === 0) {

        return;

    }

    const analysedAt = new Date().toISOString();
    const payload = reports.map((report) => normalizeReport(report, graphState, analysedAt));

    if (process.env.DEBUG === "true") {
        payload.forEach((report) => {
            const missingFields = tableColumns.filter((column) => report[column] === undefined);

            if (missingFields.length > 0) {
                console.warn("Compliance report payload missing columns:", {
                    transaction_id: report.transaction_id ?? null,
                    account_id: report.account_id ?? null,
                    missingFields,
                    keys: Object.keys(report)
                });
            }
        });
    }

    const { error } = await supabase
        .from("compliance_reports")
        .insert(payload);

    if (error) {

        console.error("Failed to save compliance reports:", error.message);
        throw error;

    }

    console.log(
        `${payload.length} compliance reports saved.`
    );

}