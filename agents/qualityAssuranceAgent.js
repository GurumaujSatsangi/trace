import { evaluateAMLRules } from "../services/amlRules.js";

export async function qualityAssuranceAgent(state) {

    if (process.env.DEBUG === "true") {
        console.log("Running AML Rule Engine...");
    }

    const enrichedTransactions = Array.isArray(state.enrichedTransactions)
        ? state.enrichedTransactions
        : [];

    const ruleResults = [];
    const queryPrompt = state.query_prompt || "CSV Upload Analysis";
    const sqlGenerated = state.sql_generated ?? null;

    let lowCount = 0;
    let mediumCount = 0;
    let highCount = 0;

    const reports = enrichedTransactions.map((tx) => {

        const transaction = tx.transaction || {};
        const enrichment = tx.enrichment || {};
        const ruleInput = {
            amount: transaction.amount,
            transaction_type: transaction.transaction_type,
            country: transaction.country,
            destination_country: transaction.destination_country,
            beneficiary_name: transaction.beneficiary_name,
            sender_name: transaction.sender_name,
            channel: transaction.channel,
            enrichment
        };
        const result = evaluateAMLRules(ruleInput);

        const riskLevel = result.risk_level || "LOW";
        if (riskLevel === "HIGH") {
            highCount += 1;
        } else if (riskLevel === "MEDIUM") {
            mediumCount += 1;
        } else {
            lowCount += 1;
        }

        ruleResults.push({
            transaction_id: transaction.transaction_id,
            account_id: transaction.account_id,
            risk_score: result.risk_score,
            confidence_score: result.confidence_score,
            risk_level: result.risk_level,
            flags: result.flags
        });

        const sanctions = enrichment.sanctions || {};
        const ipIntel = enrichment.ipIntel || {};
        const adverseMedia = enrichment.adverseMedia || {};

        return {

            transaction,

            enrichment,

            qa: {

                transaction_id: transaction.transaction_id,

                account_id: transaction.account_id,

                query_prompt: queryPrompt,

                sql_generated: sqlGenerated,

                risk_score: result.risk_score,

                confidence_score: result.confidence_score,

                risk_level: result.risk_level,

                sanctions_match: sanctions.matched || false,

                pep_match: sanctions.pep || false,

                vpn_detected: ipIntel.vpn || false,

                proxy_detected: ipIntel.proxy || false,

                adverse_media_match: adverseMedia.matched || false,

                ip_country: enrichment.ipCountry || ipIntel.country || null,

                transaction_country: enrichment.transactionCountry || transaction.country || transaction.location || null,

                exchange_rate: enrichment.exchangeRate ?? null,

                usd_amount: enrichment.usdAmount ?? null,

                structuring_detected: result.structuringDetected || false,

                layering_detected: result.layeringDetected || false,

                high_velocity_detected: result.highVelocityDetected || false,

                high_risk_jurisdiction: result.highRiskJurisdiction || false,

                behavioral_anomaly: result.behavioralAnomaly || false,

                ubo_risk: result.uboRisk || false,

                sanctions_source: result.sanctionsSource || enrichment.sanctionsSource || "OpenSanctions",

                pep_source: result.pepSource ?? enrichment.pepSource ?? null,

                adverse_media_links: Array.isArray(enrichment.adverseMediaLinks) ? enrichment.adverseMediaLinks : [],

                flags: result.flags,

                compliance_verdict: result.flags.length
                    ? `Deterministic AML screening flagged: ${result.flags.join(", ")}`
                    : "No deterministic AML flags detected.",

                aml_rule_results: result,

                analysed_at: new Date().toISOString()

            },

            investigation: {
                compliance_verdict:
                    "Transaction classified as LOW RISK. No significant AML indicators were detected. Continue routine monitoring.",
                skipped: true
            },

            decision: {}

        };

    });

    console.log("QA Complete");
    console.log("Routing");
    console.log(`LOW: ${lowCount}`);
    console.log(`MEDIUM: ${mediumCount}`);
    console.log(`HIGH: ${highCount}`);

    return {

        ruleResults,

        reports,

        graphMetrics: {
            nodesExecuted: ["qaNode"],
            apiCalls: 0,
            retries: 0,
            failedApis: []
        }

    };

}