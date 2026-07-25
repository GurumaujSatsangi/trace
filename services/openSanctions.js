import axios from "axios";

export async function checkOpenSanctions(name) {

    try {

        const response = await axios.get(
            `https://api.opensanctions.org/match/default`,
            {
                params: {
                    q: name
                }
            }
        );

        return response.data;

    } catch (err) {

        return {
            matched: false,
            error: err.message
        };

    }

}