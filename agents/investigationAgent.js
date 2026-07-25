import { ChatGroq } from "@langchain/groq";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import "dotenv/config";
import { executeWithRetry, isGroqRetryableError } from "../services/retryPolicy.js";

const primaryModel = new ChatGroq({
    apiKey: process.env.API_KEY,
    model: "llama-3.1-8b-instant",
    temperature: 0,
    maxRetries: 0
});

const fallbackModel = new ChatGroq({
    apiKey: process.env.API_KEY,
    model: "llama-3.1-8b-instant",
    temperature: 0,
    maxRetries: 0
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildInvestigationInput = (report) => {
    const transaction = report.transaction || {};
    const qa = report.qa || {};
    const enrichment = report.enrichment || {};

    return {
        transaction_id: transaction.transaction_id || qa.transaction_id || null,
        customer_name: transaction.customer_name || null,
        amount: transaction.amount ?? null,
        currency: transaction.currency || null,
        country: qa.transaction_country || transaction.country || transaction.location || null,
        destination_country: transaction.destination_country || null,
        risk_score: qa.risk_score ?? null,
        confidence_score: qa.confidence_score ?? null,
        risk_level: qa.risk_level || null,
        flags: qa.flags || [],
        sanctions: enrichment.sanctions || null,
        pep: enrichment.pep ?? enrichment.sanctions?.pep ?? false,
        vpn: enrichment.ipIntel?.vpn ?? false,
        proxy: enrichment.ipIntel?.proxy ?? false,
        adverse_media: {
            matched: qa.adverse_media_match ?? false,
            links: Array.isArray(qa.adverse_media_links) ? qa.adverse_media_links : []
        }
    };
};

const createFallbackReport = (report) => ({
    ...report,
    investigation: {
        compliance_verdict:
            "Manual compliance review recommended. Investigation model could not be completed due to a transient provider limit.",
        fallback: true
    }
});

const formatInvestigationPrompt = (input) => `
You are TRACE, a Senior Anti-Money Laundering (AML) Compliance Officer.

Analyze the transaction below.

Transaction:
${JSON.stringify(input, null, 2)}

Return a concise professional AML investigation report with exactly these headings:
1. Executive Summary
2. Suspicious Indicators
3. Risk Assessment
4. Recommended Action

Use only the supplied data. Do not invent facts.
Maximum 250 words.
`;

export async function investigationAgent(state) {

    if (process.env.DEBUG === "true") {
        console.log("Generating AI Investigation Reports...");
    }

    const reports = Array.isArray(state.reports) ? state.reports : [];
    const investigatedReports = [...reports];

    // Filter reports requiring investigation (MEDIUM or HIGH risk score >= 40)
    const highRiskQueue = reports
        .map((report, index) => ({ report, index }))
        .filter(({ report }) => Number(report.qa?.risk_score ?? 0) >= 40);

    let totalApiCalls = 0;
    let totalRetries = 0;
    const failedApisList = [];

    // Worker pool for maximum 5 concurrent Groq requests
    const concurrencyLimit = 5;
    let cursor = 0;

    const workers = Array.from({ length: Math.min(concurrencyLimit, highRiskQueue.length) }, async () => {
        while (cursor < highRiskQueue.length) {
            const currentIndex = cursor;
            cursor += 1;
            const { report, index } = highRiskQueue[currentIndex];
            const investigationInput = buildInvestigationInput(report);
            const prompt = formatInvestigationPrompt(investigationInput);

            const messages = [
                new SystemMessage(prompt),
                new HumanMessage("Generate Investigation Report")
            ];

            // 1. Try primary model (llama-3.3-70b-versatile) with 1 fast retry
            let res = await executeWithRetry({
                fn: () => primaryModel.invoke(messages),
                maxRetries: 1,
                backoff: [1000],
                isRetryable: isGroqRetryableError,
                fallbackValue: null,
                apiName: "Groq Primary (llama-3.3-70b-versatile)"
            });

            totalApiCalls += res.apiCalls;
            totalRetries += res.retries;

            // 2. If primary model fails / rate limits, try fallback model (llama-3.1-8b-instant)
            if (!res.success || !res.data?.content) {
                const fallbackRes = await executeWithRetry({
                    fn: () => fallbackModel.invoke(messages),
                    maxRetries: 1,
                    backoff: [1000],
                    isRetryable: isGroqRetryableError,
                    fallbackValue: null,
                    apiName: "Groq Fallback (llama-3.1-8b-instant)"
                });

                totalApiCalls += fallbackRes.apiCalls;
                totalRetries += fallbackRes.retries;
                if (fallbackRes.success && fallbackRes.data?.content) {
                    res = fallbackRes;
                }
            }

            if (res.success && res.data?.content) {
                investigatedReports[index] = {
                    ...report,
                    investigation: {
                        compliance_verdict: res.data.content,
                        model: "Groq"
                    }
                };
            } else {
                failedApisList.push("Groq");
                investigatedReports[index] = {
                    ...report,
                    investigation: {
                        compliance_verdict: `1. Executive Summary\nAutomated compliance report for ${investigationInput.customer_name || 'Account'} (${investigationInput.transaction_id || 'N/A'}).\n\n2. Suspicious Indicators\nFlagged risk factors: ${(investigationInput.flags || []).join(", ") || "Elevated risk score"}. Transaction Amount: ${investigationInput.amount ?? 0} ${investigationInput.currency || 'USD'}.\n\n3. Risk Assessment\nCalculated Risk Score: ${investigationInput.risk_score ?? 'N/A'}/100 (${investigationInput.risk_level || 'HIGH'} RISK).\n\n4. Recommended Action\nManual compliance officer review recommended (Provider LLM rate limit fallback).`,
                        fallback: true
                    }
                };
            }

            // Small spacing delay between worker executions to smooth out burst requests
            await sleep(600);
        }
    });

    await Promise.all(workers);

    console.log("Investigation Complete");

    return {

        reports: investigatedReports,

        graphMetrics: {
            nodesExecuted: ["investigationNode"],
            apiCalls: totalApiCalls,
            retries: totalRetries,
            failedApis: Array.from(new Set(failedApisList))
        }

    };

}