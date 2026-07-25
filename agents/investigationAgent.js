import { ChatGroq } from "@langchain/groq";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import "dotenv/config";

const model = new ChatGroq({
    apiKey: process.env.API_KEY,
    model: "llama-3.3-70b-versatile",
    temperature: 0
});

export async function investigationAgent(state) {

    console.log("Generating AI Investigation Reports...");

    const reports = Array.isArray(state.reports) ? state.reports : [];

    const investigatedReports = await Promise.all(

        reports.map(async (report) => {

            try {

                // Skip LLM for LOW risk transactions
                if ((report.risk_level || "LOW") === "LOW") {

                    return {
                        ...report,
                        compliance_verdict:
                            "Transaction classified as LOW RISK. No significant AML indicators were detected. Continue routine monitoring."
                    };

                }

                const prompt = `
You are TRACE, a Senior Anti-Money Laundering (AML) Compliance Officer.

Analyze the following transaction.

Transaction Details:
${JSON.stringify(report, null, 2)}

Generate a professional investigation report using exactly these headings:

1. Executive Summary
2. Suspicious Indicators
3. Risk Assessment
4. Recommended Action

Requirements:
- Explain WHY the transaction was flagged.
- Mention sanctions, PEP, VPN, proxy, adverse media, jurisdiction, and AML rules ONLY if present.
- Mention confidence score.
- Mention risk score.
- Mention risk level.
- Recommend an appropriate compliance action.
- Maximum 250 words.
- Do NOT invent facts.
- Base your answer ONLY on the supplied transaction data.
`;

                const response = await model.invoke([
                    new SystemMessage(prompt),
                    new HumanMessage("Generate Investigation Report")
                ]);

                return {

                    ...report,

                    compliance_verdict: response.content

                };

            }

            catch (err) {

                console.error(
                    `Investigation failed for Transaction ${report.transaction_id}:`,
                    err.message
                );

                return {

                    ...report,

                    compliance_verdict:
                        "Unable to generate AI investigation report. Manual compliance review is recommended."

                };

            }

        })

    );

    console.log("Investigation Complete.");

    return {

        ...state,

        reports: investigatedReports

    };

}