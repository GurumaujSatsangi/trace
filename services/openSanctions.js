import axios from "axios";

const isPepMatch = (candidate) => {

    const text = JSON.stringify(candidate || {}).toLowerCase();

    return text.includes("pep") || text.includes("politically exposed");

};

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

    try {

        const response = await axios.get(
            `https://api.opensanctions.org/match/default`,
            {
                params: {
                    q: name
                }
            }
        );

        const data = response.data || {};
        const matches = Array.isArray(data.results)
            ? data.results
            : Array.isArray(data.result)
                ? data.result
                : Array.isArray(data.matches)
                    ? data.matches
                    : [];

        return {

            matched: Boolean(data.matched ?? data.match ?? matches.length > 0),

            pep: Boolean(data.pep ?? data.is_pep ?? matches.some(isPepMatch)),

            score: Number(data.score ?? data.match_score ?? (matches.length > 0 ? 1 : 0)) || 0,

            matches: matches.slice(0, 5),

            raw: data

        };

    } catch (err) {

        return {
            matched: false,
            pep: false,
            score: 0,
            matches: [],
            raw: null,
            error: err.message
        };

    }

}