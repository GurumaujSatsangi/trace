import axios from "axios";

const parseBoolean = (value) => {

    if (typeof value === "boolean") return value;

    if (typeof value === "number") return value === 1;

    if (typeof value === "string") {

        return ["1", "true", "yes", "y"].includes(value.toLowerCase());

    }

    return false;

};

export async function checkIPAddress(ip) {

    if (!ip) {

        return {

            vpn: false,

            proxy: false,

            country: null,

            isp: null,

            raw: null

        };

    }

    try {

        const response = await axios.get(

            `https://proxycheck.io/v2/${ip}?vpn=1&asn=1`

        );

        const ipData = response.data?.[ip] || {};

        return {

            vpn: parseBoolean(ipData.vpn),

            proxy: parseBoolean(ipData.proxy),

            country: ipData.country || null,

            isp: ipData.isp || ipData.asn || null,

            raw: ipData

        };

    }

    catch (error) {

        console.error(`IP intelligence lookup failed for ${ip}:`, error.message);

        return {

            vpn: false,

            proxy: false,

            country: null,

            isp: null,

            raw: null,

            error: error.message

        };

    }

}