export function evaluateAMLRules(tx) {

    const flags = [];
    let riskScore = 0;

    const enrichment = tx.enrichment || {};
    const sanctions = enrichment.sanctions || {};
    const ipIntel = enrichment.ipIntel || {};
    const adverseMedia = enrichment.adverseMedia || {};
    const amount = Number(tx.amount || 0);
    const usdAmount = Number(enrichment.usdAmount || amount);
    const sourceCountry = String(tx.country || "").trim().toLowerCase();
    const destinationCountry = String(tx.destination_country || "").trim().toLowerCase();
    const highRiskJurisdictions = ["iran", "north korea", "myanmar", "syria", "afghanistan"];

    // -----------------------------
    // Rule 1 : Structuring
    // -----------------------------
    if (
        amount >= 9000 &&
        amount < 10000 &&
        /cash|deposit/i.test(String(tx.transaction_type || ""))
    ) {

        flags.push("Possible Structuring");

        riskScore += 20;

    }

    // -----------------------------
    // Rule 2 : Sanctions
    // -----------------------------
    if (sanctions.matched) {

        flags.push("Sanctions Match");

        riskScore += 40;

    }

    // -----------------------------
    // Rule 3 : PEP
    // -----------------------------
    if (sanctions.pep) {

        flags.push("Politically Exposed Person");

        riskScore += 30;

    }

    // -----------------------------
    // Rule 4 : VPN
    // -----------------------------
    if (ipIntel.vpn === true) {

        flags.push("VPN Detected");

        riskScore += 15;

    }

    // -----------------------------
    // Rule 5 : Proxy
    // -----------------------------
    if (ipIntel.proxy === true) {

        flags.push("Proxy Detected");

        riskScore += 15;

    }

    // -----------------------------
    // Rule 6 : High Risk Country
    // -----------------------------
    if (
        highRiskJurisdictions.includes(sourceCountry) ||
        highRiskJurisdictions.includes(destinationCountry)
    ) {

        flags.push("High Risk Jurisdiction");

        riskScore += 25;

    }

    // -----------------------------
    // Rule 7 : Adverse Media
    // -----------------------------
    if (adverseMedia.matched || (Array.isArray(adverseMedia.articles) && adverseMedia.articles.length > 0)) {

        flags.push("Adverse Media");

        riskScore += 15;

    }

    // -----------------------------
    // Rule 8 : Layering
    // -----------------------------
    if (
        /transfer|wire|swift|corporate/i.test(String(tx.transaction_type || "")) &&
        destinationCountry &&
        destinationCountry !== sourceCountry &&
        !/self/i.test(String(tx.beneficiary_name || ""))
    ) {

        flags.push("Possible Layering");

        riskScore += 20;

    }

    // -----------------------------
    // Rule 9 : Behavioral Anomaly
    // -----------------------------
    if (
        (ipIntel.vpn || ipIntel.proxy) &&
        /online|internet|mobile/i.test(String(tx.channel || ""))
    ) {

        flags.push("Behavioral Anomaly");

        riskScore += 10;

    }

    // -----------------------------
    // Rule 8 : Large Transaction
    // -----------------------------
    if (usdAmount > 100000) {

        flags.push("Large Transaction");

        riskScore += 10;

    }

    // -----------------------------
    // Confidence Score
    // -----------------------------
    const confidenceScore = Math.min(
        100,
        Math.round(
            riskScore * 1.2
        )
    );

    // -----------------------------
    // Risk Level
    // -----------------------------
    let riskLevel = "LOW";

    if (riskScore >= 70)
        riskLevel = "HIGH";

    else if (riskScore >= 40)
        riskLevel = "MEDIUM";

    return {

        risk_score: riskScore,

        confidence_score: confidenceScore,

        risk_level: riskLevel,

        flags

    };

}