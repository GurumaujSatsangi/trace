import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const normalizeReport = (report, graphState, analysedAt) => ({

    transaction_id: report.transaction_id ?? null,

    account_id: report.account_id ?? null,

    query_prompt: report.query_prompt ?? graphState.query_prompt ?? "CSV Upload Analysis",

    risk_score: Number(report.risk_score ?? 0),

    confidence_score: Number(report.confidence_score ?? 0),

    risk_level: report.risk_level ?? "LOW",

    action_recommended: report.action_recommended ?? "Monitor",

    sanctions_match: Boolean(report.sanctions_match),

    pep_match: Boolean(report.pep_match),

    vpn_detected: Boolean(report.vpn_detected),

    proxy_detected: Boolean(report.proxy_detected),

    adverse_media_match: Boolean(report.adverse_media_match),

    flags: Array.isArray(report.flags) ? report.flags : [],

    compliance_verdict: report.compliance_verdict ?? "",

    enrichment_data: report.enrichment_data ?? {},

    aml_rule_results: report.aml_rule_results ?? {},

    graph_state: graphState,

    analysed_at: report.analysed_at ?? analysedAt

});

export async function saveComplianceReports(reports, graphState = {}) {

    if (!Array.isArray(reports) || reports.length === 0) {

        return;

    }

    const analysedAt = new Date().toISOString();
    const payload = reports.map((report) => normalizeReport(report, graphState, analysedAt));

    payload.forEach((report) => {
        console.log("Preparing compliance report payload keys:", Object.keys(report));
    });

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