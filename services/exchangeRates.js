import axios from "axios";

export async function exchangeRate(from, to) {

    try {

        const response = await axios.get(

            `https://open.er-api.com/v6/latest/${from}`

        );

        const rate = Number(response.data?.rates?.[to]);

        return Number.isFinite(rate) && rate > 0 ? rate : 1;

    }

    catch (error) {

        console.error("Exchange rate lookup failed:", error.message);

        return 1;

    }

}