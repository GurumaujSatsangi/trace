import axios from "axios";

let newsApiRateLimited = false;
let rateLimitLogged = false;
const nameCache = new Map();

export async function adverseMediaSearch(name) {
    if (!name || typeof name !== "string") {
        return [];
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
        return [];
    }

    // Return cached result if already searched in this run
    if (nameCache.has(trimmedName)) {
        return nameCache.get(trimmedName);
    }

    // 1. Try NewsAPI if API key exists and is not rate-limited
    if (process.env.NEWS_API && !newsApiRateLimited) {
        try {
            const response = await axios.get("https://newsapi.org/v2/everything", {
                params: {
                    q: `"${trimmedName}"`,
                    apiKey: process.env.NEWS_API,
                    pageSize: 5
                },
                timeout: 4000
            });

            const articles = Array.isArray(response.data?.articles)
                ? response.data.articles
                : [];

            const results = articles.slice(0, 5);
            nameCache.set(trimmedName, results);
            return results;
        } catch (error) {
            const status = error?.response?.status;
            if (status === 429 || status === 426) {
                newsApiRateLimited = true;
                if (!rateLimitLogged) {
                    console.warn("[News Screening] NewsAPI rate limit reached (429). Falling back to GDELT Open News Engine.");
                    rateLimitLogged = true;
                }
            } else if (status === 401) {
                newsApiRateLimited = true;
                console.warn("[News Screening] NewsAPI key invalid (401). Falling back to GDELT Open News Engine.");
            }
        }
    }

    // 2. Fallback to GDELT Public Adverse Media API (Free, no rate limits, no API key required)
    try {
        const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent('"' + trimmedName + '"')}&mode=artlist&maxrecords=5&format=json`;
        const response = await axios.get(gdeltUrl, { timeout: 5000 });

        const articles = Array.isArray(response.data?.articles)
            ? response.data.articles.map((art) => ({
                title: art.title || `News report mentioning ${trimmedName}`,
                url: art.url,
                source: { name: art.domain || "GDELT News" },
                publishedAt: art.seendate || new Date().toISOString()
            }))
            : [];

        nameCache.set(trimmedName, articles);
        return articles;
    } catch (gdeltErr) {
        nameCache.set(trimmedName, []);
        return [];
    }
}