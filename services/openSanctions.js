import axios from "axios";
import "dotenv/config";

export async function checkOpenSanctions(name) {
    if (!name) {
        return {
            matched: false,
            pep: false,
            score: 0,
            matches: [],
            raw: null
        };
    }

    const apiKey = process.env.OPENSANCTIONS_API_KEY;
    let matches = [];
    let rawData = null;

    // Multi-tier attempt strategy:
    // 1. POST /match/default with Authorization: ApiKey <KEY>
    // 2. POST /match/default with Authorization: Bearer <KEY>
    // 3. GET /search/default with api_key query param
    try {
        const response = await axios.post(
            `https://api.opensanctions.org/match/default`,
            {
                queries: {
                    q1: {
                        schema: "Person",
                        properties: {
                            name: [name]
                        }
                    }
                }
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    ...(apiKey ? { Authorization: `ApiKey ${apiKey}` } : {})
                }
            }
        );
        rawData = response.data || {};
        matches = rawData.responses?.q1?.results || [];
    } catch (err1) {
        try {
            const response = await axios.post(
                `https://api.opensanctions.org/match/default`,
                {
                    queries: {
                        q1: {
                            schema: "Person",
                            properties: {
                                name: [name]
                            }
                        }
                    }
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
                    }
                }
            );
            rawData = response.data || {};
            matches = rawData.responses?.q1?.results || [];
        } catch (err2) {
            try {
                const response = await axios.get(
                    `https://api.opensanctions.org/search/default`,
                    {
                        params: {
                            q: name,
                            ...(apiKey ? { api_key: apiKey } : {})
                        }
                    }
                );
                rawData = response.data || {};
                matches = rawData.results || [];
            } catch (err3) {
                return {
                    matched: false,
                    pep: false,
                    score: 0,
                    matches: [],
                    raw: null,
                    error: err3.message || err2.message || err1.message
                };
            }
        }
    }

    const matched = matches.some((m) => m.match === true || (m.score != null && Number(m.score) >= 0.7));

    const isPep = matches.some((m) => {
        if (!(m.match === true || (m.score != null && Number(m.score) >= 0.7))) {
            return false;
        }
        const topics = [...(m.properties?.topics || []), ...(m.topics || [])];
        const datasets = m.datasets || [];
        return (
            topics.some((t) => String(t).toLowerCase().includes("pep")) ||
            datasets.some((d) => String(d).toLowerCase().includes("pep"))
        );
    });

    const topMatch = matches[0];
    const score = topMatch ? Number(topMatch.score || 0) : 0;

    return {
        matched,
        pep: isPep,
        score,
        source: "OpenSanctions",
        pepSource: isPep ? "OpenSanctions" : null,
        matches: matches.slice(0, 5),
        raw: rawData
    };
}