const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isTimeoutError(error) {
    if (!error) return false;
    const msg = String(error.message || "").toLowerCase();
    const code = String(error.code || "").toUpperCase();
    return (
        code === "ECONNABORTED" ||
        code === "ETIMEDOUT" ||
        msg.includes("timeout") ||
        msg.includes("timed out")
    );
}

export function isGroqRetryableError(error) {
    if (!error) return false;
    const status = String(
        error.status || error.response?.status || error.statusCode || error.error?.status || ""
    );
    const msg = String(error.message || "").toLowerCase();
    const retryableStatuses = ["429", "500", "502", "503", "504"];
    if (retryableStatuses.includes(status)) return true;
    if (
        msg.includes("429") ||
        msg.includes("rate limit") ||
        msg.includes("rate_limit") ||
        msg.includes("too many requests") ||
        msg.includes("quota") ||
        msg.includes("tpm") ||
        msg.includes("rpm")
    ) {
        return true;
    }
    return isTimeoutError(error);
}

export async function executeWithRetry({
    fn,
    maxRetries = 3,
    backoff = [2000, 4000, 8000],
    isRetryable = isTimeoutError,
    fallbackValue = null,
    apiName = "API"
}) {
    let apiCalls = 0;
    let retries = 0;

    // Default timeout of 15000ms if not specified
    const timeoutMs = 15000;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        apiCalls += 1;
        try {
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => {
                    const err = new Error(`Timeout of ${timeoutMs}ms exceeded`);
                    err.code = "ETIMEDOUT";
                    reject(err);
                }, timeoutMs)
            );
            const data = await Promise.race([fn(), timeoutPromise]);
            
            return {
                success: true,
                data,
                apiCalls,
                retries,
                failed: false
            };
        } catch (error) {
            const canRetry = attempt < maxRetries && isRetryable(error);
            if (canRetry) {
                retries += 1;
                const delay = backoff[attempt] || backoff[backoff.length - 1] || 2000;
                if (process.env.DEBUG === "true") {
                    console.warn(`[RetryPolicy] ${apiName} failed (${error.message}). Retrying ${attempt + 1}/${maxRetries} in ${delay}ms...`);
                }
                await sleep(delay);
            } else {
                if (process.env.DEBUG === "true") {
                    console.warn(`[RetryPolicy] ${apiName} failed after ${retries} retries: ${error.message}`);
                }
                return {
                    success: false,
                    data: fallbackValue,
                    error: error.message,
                    apiCalls,
                    retries,
                    failed: true
                };
            }
        }
    }

    return {
        success: false,
        data: fallbackValue,
        error: "Max retries exceeded",
        apiCalls,
        retries,
        failed: true
    };
}
