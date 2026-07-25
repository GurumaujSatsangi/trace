import axios from "axios";

export async function adverseMediaSearch(name) {

    // Replace with NewsAPI/GDELT later

    if (!process.env.NEWS_API) {

        console.warn("NEWS_API not configured. Skipping adverse media enrichment.");

        return [];

    }

    if (!name) {

        return [];

    }

    try {

        const response = await axios.get(

            `https://newsapi.org/v2/everything`,

            {

                params: {

                    q: name,

                    apiKey: process.env.NEWS_API

                }

            }

        );

        const articles = Array.isArray(response.data?.articles)
            ? response.data.articles
            : [];

        return articles.slice(0, 5);

    }

    catch (error) {

        if (error?.response?.status === 401) {

            console.warn("NEWS_API request returned 401. Skipping adverse media enrichment.");

            return [];

        }

        console.error(`Adverse media search failed for ${name}:`, error.message);

        return [];

    }

}