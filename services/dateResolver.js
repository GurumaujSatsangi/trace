/**
 * Dataset-relative date resolver.
 * Discovers the timestamp column from the active DuckDB view and resolves
 * relative date expressions (e.g. "last 30 days") using the dataset's
 * maximum timestamp — NOT the server/system date.
 *
 * Takes runDuckQuery as a dependency to avoid importing DuckDB directly.
 */

/**
 * Discover all columns and their types from the active transactions view.
 * @param {Function} runDuckQuery
 * @returns {Promise<Array<{column_name: string, column_type: string}>>}
 */
async function discoverSchema(runDuckQuery) {
    try {
        const rows = await runDuckQuery("DESCRIBE SELECT * FROM transactions LIMIT 0");
        return rows.map(r => ({
            column_name: r.column_name,
            column_type: r.column_type
        }));
    } catch (err) {
        console.error("dateResolver: failed to discover schema:", err.message);
        return [];
    }
}

/**
 * Find the timestamp/date column from the schema.
 * Looks for columns with timestamp or date types, preferring 'timestamp' by name.
 * @param {Array} schema
 * @returns {string|null}
 */
function findTimestampColumn(schema) {
    // First: prefer a column literally named "timestamp"
    const exactMatch = schema.find(
        c => c.column_name.toLowerCase() === "timestamp"
    );
    if (exactMatch) return exactMatch.column_name;

    // Second: look for any column with a timestamp/date type
    const dateTypes = ["timestamp", "date", "timestamptz", "timestamp with time zone", "datetime"];
    const typeMatch = schema.find(
        c => dateTypes.some(t => c.column_type.toLowerCase().includes(t))
    );
    if (typeMatch) return typeMatch.column_name;

    // Third: look for common timestamp column name patterns
    const namePatterns = ["timestamp", "date", "created_at", "transaction_date", "txn_date"];
    const nameMatch = schema.find(
        c => namePatterns.some(p => c.column_name.toLowerCase().includes(p))
    );
    if (nameMatch) return nameMatch.column_name;

    return null;
}

/**
 * Parse a date expression into a number of days and direction.
 * @param {string} expression - e.g. "last 30 days", "previous 7 days"
 * @returns {{ days: number } | null}
 */
function parseDateExpression(expression) {
    if (!expression || typeof expression !== "string") return null;

    const normalized = expression.toLowerCase().trim();

    // Match patterns like "last 30 days", "previous 7 days", "past 14 days"
    const match = normalized.match(/(?:last|previous|past)\s+(\d+)\s+days?/);
    if (match) {
        return { days: parseInt(match[1], 10) };
    }

    // Match "N days ago"
    const agoMatch = normalized.match(/(\d+)\s+days?\s+ago/);
    if (agoMatch) {
        return { days: parseInt(agoMatch[1], 10) };
    }

    return null;
}

/**
 * Resolve a relative date expression into concrete start/end timestamps
 * based on the dataset's maximum timestamp.
 *
 * @param {object} params
 * @param {string} params.dateExpression - e.g. "last 30 days"
 * @param {Function} params.runDuckQuery
 * @returns {Promise<{ start: string, end: string, maxTimestamp: string, timestampColumn: string } | { error: string }>}
 */
export async function resolveDateFilter({ dateExpression, runDuckQuery }) {
    if (!dateExpression) {
        return { error: "No date expression provided." };
    }

    const parsed = parseDateExpression(dateExpression);
    if (!parsed) {
        return { error: `Could not parse the date expression: "${dateExpression}". Try formats like "last 30 days" or "previous 7 days".` };
    }

    // Discover schema to find the timestamp column
    const schema = await discoverSchema(runDuckQuery);
    if (schema.length === 0) {
        return { error: "Could not read the active dataset schema." };
    }

    const timestampCol = findTimestampColumn(schema);
    if (!timestampCol) {
        return { error: "I can't apply the requested relative date range because the active dataset has no valid transaction timestamps." };
    }

    // Get the maximum timestamp from the dataset
    try {
        const maxResult = await runDuckQuery(
            `SELECT MAX("${timestampCol}")::TIMESTAMP AS max_ts FROM transactions WHERE "${timestampCol}" IS NOT NULL`
        );

        if (!maxResult || maxResult.length === 0 || !maxResult[0].max_ts) {
            return { error: "I can't apply the requested relative date range because the active dataset has no valid transaction timestamps." };
        }

        const maxTs = maxResult[0].max_ts;

        // Compute the interval using DuckDB
        const intervalResult = await runDuckQuery(
            `SELECT 
                ('${maxTs}'::TIMESTAMP - INTERVAL '${parsed.days} days')::TIMESTAMP AS start_ts,
                '${maxTs}'::TIMESTAMP AS end_ts`
        );

        if (!intervalResult || intervalResult.length === 0) {
            return { error: "Failed to compute the date interval." };
        }

        return {
            start: String(intervalResult[0].start_ts),
            end: String(intervalResult[0].end_ts),
            maxTimestamp: String(maxTs),
            timestampColumn: timestampCol,
            days: parsed.days
        };
    } catch (err) {
        console.error("dateResolver: failed to resolve date filter:", err.message);
        return { error: `Failed to resolve the date range: ${err.message}` };
    }
}

/**
 * Get the full schema of the active transactions view.
 * Useful for schema-aware operations.
 */
export async function getTransactionSchema(runDuckQuery) {
    return discoverSchema(runDuckQuery);
}
