export async function decisionAgent(state) {

    const reports = (Array.isArray(state.reports) ? state.reports : []).map((report) => {

        let action = "Monitor";

        if (report.risk_score >= 85) {

            action = "Freeze Transaction";

        }

        else if (report.risk_score >= 70) {

            action = "Generate SAR";

        }

        else if (report.risk_score >= 50) {

            action = "Enhanced Due Diligence";

        }

        else if (report.risk_score >= 30) {

            action = "Manual Review";

        }

        return {

            ...report,

            action_recommended: action

        };

    });

    return {

        ...state,

        reports

    };

}