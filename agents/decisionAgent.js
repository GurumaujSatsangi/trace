export async function decisionAgent(state) {

    const reports = (Array.isArray(state.reports) ? state.reports : []).map((report) => {

        const riskScore = Number(report.qa?.risk_score ?? 0);
        const sanctionsMatched = Boolean(report.qa?.sanctions_match || report.enrichment?.sanctions?.matched);

        let action = "Monitor";

        if (sanctionsMatched) {

            action = "Freeze Transaction";

        } else if (riskScore >= 90) {

            action = "Generate SAR";

        } else if (riskScore >= 70) {

            action = "Enhanced Due Diligence";

        } else if (riskScore >= 40) {

            action = "Manual Review";

        } else {

            action = "Monitor";

        }

        return {

            ...report,

            decision: {
                action_recommended: action
            }

        };

    });

    console.log("Decision Complete");

    return {

        reports,

        graphMetrics: {
            nodesExecuted: ["decisionNode"],
            apiCalls: 0,
            retries: 0,
            failedApis: []
        }

    };

}