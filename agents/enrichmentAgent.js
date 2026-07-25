import { checkOpenSanctions } from "../services/openSanctions.js";
import { checkIPAddress } from "../services/ipIntel.js";
import { adverseMediaSearch } from "../services/newsScreening.js";
import { exchangeRate } from "../services/exchangeRates.js";
import { executeWithRetry, isTimeoutError } from "../services/retryPolicy.js";

const normalizeAdverseMedia = (mediaResult) => {
    if (!Array.isArray(mediaResult)) {
        return mediaResult?.error
            ? { matched: false, links: [], articles: [], source: "NewsAPI", error: mediaResult.error }
            : mediaResult || { matched: false, links: [], articles: [], source: "NewsAPI" };
    }

    const links = mediaResult
        .map((article) => article?.url)
        .filter(Boolean);

    return {
        matched: links.length > 0,
        links,
        articles: mediaResult,
        source: "NewsAPI"
    };
};

export async function loadTransactionsAgent(state) {
    const startedAt = state.startedAt || new Date().toISOString();
    console.log("Graph Started");
    console.log("Parallel Enrichment Started");

    return {
        startedAt,
        graphMetrics: {
            startedAt,
            nodesExecuted: ["loadTransactionsNode"],
            apiCalls: 0,
            retries: 0,
            failedApis: []
        }
    };
}

export async function openSanctionsAgent(state) {
    const transactions = Array.isArray(state.transactions) ? state.transactions : [];
    const openSanctionsMap = {};
    let totalApiCalls = 0;
    let totalRetries = 0;
    const failedApisList = [];

    const results = await Promise.all(
        transactions.map(async (tx) => {
            const fallback = { matched: false, pep: false, score: 0, matches: [], unavailable: true };
            const res = await executeWithRetry({
                fn: () => checkOpenSanctions(tx.customer_name),
                maxRetries: 3,
                backoff: [2000, 4000, 8000],
                isRetryable: isTimeoutError,
                fallbackValue: fallback,
                apiName: "OpenSanctions"
            });

            return { transaction_id: tx.transaction_id, result: res };
        })
    );

    for (const item of results) {
        const { transaction_id, result } = item;
        totalApiCalls += result.apiCalls;
        totalRetries += result.retries;
        if (result.failed) {
            failedApisList.push("OpenSanctions");
        }
        openSanctionsMap[transaction_id] = result.data || { matched: false, pep: false, score: 0, matches: [] };
    }

    console.log("OpenSanctions Complete");

    return {
        openSanctions: openSanctionsMap,
        graphMetrics: {
            nodesExecuted: ["openSanctionsNode"],
            apiCalls: totalApiCalls,
            retries: totalRetries,
            failedApis: Array.from(new Set(failedApisList))
        }
    };
}

export async function ipIntelAgent(state) {
    const transactions = Array.isArray(state.transactions) ? state.transactions : [];
    const ipIntelMap = {};
    let totalApiCalls = 0;
    let totalRetries = 0;
    const failedApisList = [];

    const results = await Promise.all(
        transactions.map(async (tx) => {
            const fallback = { vpn: false, proxy: false, country: null, isp: null, unavailable: true };
            const res = await executeWithRetry({
                fn: () => checkIPAddress(tx.ip_address || ""),
                maxRetries: 3,
                backoff: [2000, 4000, 8000],
                isRetryable: isTimeoutError,
                fallbackValue: fallback,
                apiName: "IP Intelligence"
            });

            return { transaction_id: tx.transaction_id, result: res };
        })
    );

    for (const item of results) {
        const { transaction_id, result } = item;
        totalApiCalls += result.apiCalls;
        totalRetries += result.retries;
        if (result.failed) {
            failedApisList.push("IP Intelligence");
        }
        ipIntelMap[transaction_id] = result.data || { vpn: false, proxy: false, country: null, isp: null };
    }

    console.log("IP Intel Complete");

    return {
        ipIntel: ipIntelMap,
        graphMetrics: {
            nodesExecuted: ["ipIntelNode"],
            apiCalls: totalApiCalls,
            retries: totalRetries,
            failedApis: Array.from(new Set(failedApisList))
        }
    };
}

export async function exchangeRateAgent(state) {
    const transactions = Array.isArray(state.transactions) ? state.transactions : [];
    const exchangeRatesMap = {};
    let totalApiCalls = 0;
    let totalRetries = 0;
    const failedApisList = [];

    const currencies = Array.from(new Set(transactions.map((tx) => tx.currency || "USD")));

    const results = await Promise.all(
        currencies.map(async (curr) => {
            const res = await executeWithRetry({
                fn: () => exchangeRate(curr, "USD"),
                maxRetries: 3,
                backoff: [2000, 4000, 8000],
                isRetryable: isTimeoutError,
                fallbackValue: 1,
                apiName: "Exchange Rate API"
            });

            return { currency: curr, result: res };
        })
    );

    for (const item of results) {
        const { currency, result } = item;
        totalApiCalls += result.apiCalls;
        totalRetries += result.retries;
        if (result.failed) {
            failedApisList.push("Exchange Rate API");
        }
        exchangeRatesMap[currency] = result.data || 1;
    }

    console.log("Exchange Rate Complete");

    return {
        exchangeRates: exchangeRatesMap,
        graphMetrics: {
            nodesExecuted: ["exchangeRateNode"],
            apiCalls: totalApiCalls,
            retries: totalRetries,
            failedApis: Array.from(new Set(failedApisList))
        }
    };
}

export async function adverseMediaAgent(state) {
    const transactions = Array.isArray(state.transactions) ? state.transactions : [];
    const adverseMediaMap = {};
    let totalApiCalls = 0;
    let totalRetries = 0;
    const failedApisList = [];

    const results = await Promise.all(
        transactions.map(async (tx) => {
            const res = await executeWithRetry({
                fn: () => adverseMediaSearch(tx.customer_name),
                maxRetries: 1,
                backoff: [1000],
                isRetryable: isTimeoutError,
                fallbackValue: [],
                apiName: "News API"
            });

            return { transaction_id: tx.transaction_id, result: res };
        })
    );

    for (const item of results) {
        const { transaction_id, result } = item;
        totalApiCalls += result.apiCalls;
        totalRetries += result.retries;
        if (result.failed) {
            failedApisList.push("News API");
        }
        adverseMediaMap[transaction_id] = result.data || [];
    }

    console.log("News Screening Complete");

    return {
        adverseMedia: adverseMediaMap,
        graphMetrics: {
            nodesExecuted: ["adverseMediaNode"],
            apiCalls: totalApiCalls,
            retries: totalRetries,
            failedApis: Array.from(new Set(failedApisList))
        }
    };
}

export async function mergeEnrichmentAgent(state) {
    const transactions = Array.isArray(state.transactions) ? state.transactions : [];
    const openSanctionsMap = state.openSanctions || {};
    const ipIntelMap = state.ipIntel || {};
    const exchangeRatesMap = state.exchangeRates || {};
    const adverseMediaMap = state.adverseMedia || {};

    const accountCounts = new Map();
    for (const tx of transactions) {
        const accountId = tx.account_id || "";
        accountCounts.set(accountId, (accountCounts.get(accountId) || 0) + 1);
    }

    const enrichmentData = {};
    const enrichedTransactions = transactions.map((tx) => {
        const txId = tx.transaction_id;
        const sanctionsResult = openSanctionsMap[txId] || { matched: false, pep: false, score: 0, matches: [] };
        const ipResult = ipIntelMap[txId] || { vpn: false, proxy: false, country: null, isp: null };
        const mediaResult = adverseMediaMap[txId] || [];
        const fxRateResult = exchangeRatesMap[tx.currency || "USD"] ?? 1;

        const sanctions = sanctionsResult?.error
            ? { matched: false, pep: false, score: 0, matches: [], error: sanctionsResult.error }
            : sanctionsResult;

        const ipIntel = ipResult?.error
            ? { vpn: false, proxy: false, country: null, isp: null, error: ipResult.error }
            : ipResult;

        const adverseMedia = mediaResult?.error
            ? { matched: false, links: [], articles: [], source: "NewsAPI", error: mediaResult.error }
            : normalizeAdverseMedia(mediaResult);

        const exchange_rate = Number.isFinite(Number(fxRateResult)) && Number(fxRateResult) > 0
            ? Number(fxRateResult)
            : 1;

        const usd_amount = Number(tx.amount || 0) * exchange_rate;
        const transaction_country = tx.country || tx.location || null;
        const account_transaction_count = accountCounts.get(tx.account_id || "") || 0;

        const enrichment = {
            sanctions,
            pep: sanctions.pep || false,
            ipIntel,
            exchangeRate: exchange_rate,
            usdAmount: usd_amount,
            adverseMedia,
            transactionCountry: transaction_country,
            destinationCountry: tx.destination_country || null,
            accountTransactionCount: account_transaction_count,
            ipCountry: ipIntel.country || null,
            sanctionsSource: sanctions.source || "OpenSanctions",
            pepSource: sanctions.pepSource ?? (sanctions.pep ? (sanctions.source || "OpenSanctions") : null),
            adverseMediaLinks: adverseMedia.links || []
        };

        enrichmentData[txId] = enrichment;

        return {
            transaction: tx,
            enrichment,
            qa: {},
            investigation: {},
            decision: {}
        };
    });

    console.log("Merge Complete");

    return {
        enrichmentData,
        enrichedTransactions,
        graphMetrics: {
            nodesExecuted: ["mergeEnrichmentNode"],
            apiCalls: 0,
            retries: 0,
            failedApis: []
        }
    };
}