import { checkOpenSanctions } from "../services/openSanctions.js";
import { checkIPAddress } from "../services/ipIntel.js";
import { adverseMediaSearch } from "../services/newsScreening.js";
import { exchangeRate } from "../services/exchangeRates.js";

const withFallback = (promise) => promise.catch((error) => ({ error: error.message }));

export async function enrichmentAgent(state) {

    const transactions = Array.isArray(state.transactions) ? state.transactions : [];

    console.log(`Starting enrichment for ${transactions.length} transactions...`);

    const enrichedTransactions = await Promise.all(

        transactions.map(async (tx) => {

            const [sanctionsResult, ipResult, mediaResult, fxRateResult] = await Promise.all([

                withFallback(checkOpenSanctions(tx.customer_name)),

                withFallback(checkIPAddress(tx.ip_address || "")),

                withFallback(adverseMediaSearch(tx.customer_name)),

                withFallback(exchangeRate(tx.currency || "USD", "USD"))

            ]);

            const sanctions = sanctionsResult?.error
                ? { matched: false, pep: false, score: 0, matches: [], error: sanctionsResult.error }
                : sanctionsResult;

            const ipIntel = ipResult?.error
                ? { vpn: false, proxy: false, country: null, isp: null, error: ipResult.error }
                : ipResult;

            const adverseMedia = mediaResult?.error
                ? { matched: false, articles: [], totalResults: 0, error: mediaResult.error }
                : mediaResult;

            const exchange_rate = Number.isFinite(Number(fxRateResult)) && Number(fxRateResult) > 0
                ? Number(fxRateResult)
                : 1;

            const usd_amount = Number(tx.amount || 0) * exchange_rate;

            return {

                ...tx,

                enrichment: {

                    sanctions,

                    ipIntel,

                    adverseMedia,

                    exchange_rate,

                    usd_amount

                }

            };

        })

    );

    console.log("Enrichment Complete");

    return {

        ...state,

        enrichedTransactions

    };

}