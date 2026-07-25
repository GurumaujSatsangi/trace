import { evaluateAMLRules } from "../services/amlRules.js";

export async function qualityAssuranceAgent(state) {

    console.log("Running AML Rule Engine...");

    const enrichedTransactions = Array.isArray(state.enrichedTransactions)
        ? state.enrichedTransactions
        : [];

    const ruleResults = [];

    const reports = enrichedTransactions.map((tx) => {

        const result = evaluateAMLRules(tx);

        ruleResults.push({

            transaction_id: tx.transaction_id,

            account_id: tx.account_id,

            risk_score: result.risk_score,

            confidence_score: result.confidence_score,

            risk_level: result.risk_level,

            flags: result.flags

        });

        const sanctions = tx.enrichment?.sanctions || {};
        const ipIntel = tx.enrichment?.ipIntel || {};
        const adverseMedia = tx.enrichment?.adverseMedia || {};

        return {

            ...tx,

            transaction_id: tx.transaction_id,

            account_id: tx.account_id,

            customer_name: tx.customer_name,

            risk_score: result.risk_score,

            confidence_score: result.confidence_score,

            risk_level: result.risk_level,

            sanctions_match: sanctions.matched || false,

            pep_match: sanctions.pep || false,

            vpn_detected: ipIntel.vpn || false,

            proxy_detected: ipIntel.proxy || false,

            adverse_media_match: adverseMedia.matched || false,

            action_recommended: tx.action_recommended || null,

            compliance_verdict: result.flags.length
                ? `Deterministic AML screening flagged: ${result.flags.join(", ")}`
                : "No deterministic AML flags detected.",

            flags: result.flags,

            enrichment_data: tx.enrichment,

            aml_rule_results: result,

            analysed_at: new Date().toISOString()

        };

    });

    console.log("QA Complete");

    return {

        ...state,

        ruleResults,

        reports

    };

}