/**
 * Structuring Detector — candidate pattern detection using only existing
 * amlRules.js indicators and schema-discovered fields.
 *
 * The existing structuring indicator in amlRules.js is:
 *   amount >= 9000 && amount < 10000 && transaction_type matches /cash|deposit/i
 *
 * This detector groups transactions by account/customer within a date range
 * and identifies CANDIDATE structuring patterns — not definitive structuring.
 * No new AML thresholds are invented.
 */

import { getTransactionSchema } from "./dateResolver.js";

/**
 * Detect candidate structuring patterns in the active dataset.
 *
 * @param {object} params
 * @param {object} params.dateFilter - { start, end, timestampColumn } from dateResolver, or null
 * @param {object} params.filters - resolved filters (e.g. riskLevel)
 * @param {Function} params.runDuckQuery
 * @returns {Promise<{ candidates: Array, summary: string, transactionsInRange: number } | { error: string }>}
 */
export async function detectStructuring({ dateFilter, filters, runDuckQuery }) {
    // Discover available columns
    const schema = await getTransactionSchema(runDuckQuery);
    if (!schema || schema.length === 0) {
        return { error: "Could not read the active dataset schema." };
    }

    const columnNames = new Set(schema.map(c => c.column_name.toLowerCase()));

    // Determine grouping column — prefer account_id, fallback to customer_name
    let groupCol = null;
    if (columnNames.has("account_id")) groupCol = "account_id";
    else if (columnNames.has("customer_name")) groupCol = "customer_name";
    else if (columnNames.has("customer_id")) groupCol = "customer_id";

    if (!groupCol) {
        return { error: "The active dataset does not have account_id, customer_name, or customer_id columns needed for structuring analysis." };
    }

    // Check for required columns
    const hasAmount = columnNames.has("amount");
    const hasTransactionType = columnNames.has("transaction_type");
    const hasTimestamp = dateFilter && dateFilter.timestampColumn && columnNames.has(dateFilter.timestampColumn.toLowerCase());

    if (!hasAmount) {
        return { error: "The active dataset does not have an 'amount' column needed for structuring analysis." };
    }

    // Build WHERE clause
    const whereClauses = [];

    if (hasTimestamp && dateFilter && dateFilter.start && dateFilter.end) {
        whereClauses.push(
            `"${dateFilter.timestampColumn}"::TIMESTAMP >= '${dateFilter.start}'::TIMESTAMP AND "${dateFilter.timestampColumn}"::TIMESTAMP <= '${dateFilter.end}'::TIMESTAMP`
        );
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    try {
        // Count transactions in range
        const countResult = await runDuckQuery(
            `SELECT COUNT(*) AS cnt FROM transactions ${whereStr}`
        );
        const transactionsInRange = Number(countResult[0]?.cnt || 0);

        if (transactionsInRange === 0) {
            const rangeDesc = dateFilter ? `between ${dateFilter.start} and ${dateFilter.end}` : "in the dataset";
            return {
                candidates: [],
                summary: `No transactions found ${rangeDesc}.`,
                transactionsInRange: 0
            };
        }

        // Build the structuring indicator expression using existing amlRules.js criteria:
        // amount >= 9000 AND amount < 10000 AND transaction_type matches cash/deposit
        let nearThresholdExpr;
        if (hasTransactionType) {
            nearThresholdExpr = `(CAST(amount AS DOUBLE) >= 9000 AND CAST(amount AS DOUBLE) < 10000 AND transaction_type ILIKE ANY(ARRAY['%cash%', '%deposit%']))`;
        } else {
            // Without transaction_type, can only check the amount range
            nearThresholdExpr = `(CAST(amount AS DOUBLE) >= 9000 AND CAST(amount AS DOUBLE) < 10000)`;
        }

        // Group by account/customer and compute features
        const groupQuery = `
            SELECT 
                "${groupCol}" AS group_id,
                COUNT(*) AS transaction_count,
                ROUND(SUM(CAST(amount AS DOUBLE)), 2) AS total_amount,
                ROUND(AVG(CAST(amount AS DOUBLE)), 2) AS avg_amount,
                ROUND(MIN(CAST(amount AS DOUBLE)), 2) AS min_amount,
                ROUND(MAX(CAST(amount AS DOUBLE)), 2) AS max_amount,
                SUM(CASE WHEN ${nearThresholdExpr} THEN 1 ELSE 0 END) AS near_threshold_count
            FROM transactions
            ${whereStr}
            GROUP BY "${groupCol}"
            HAVING SUM(CASE WHEN ${nearThresholdExpr} THEN 1 ELSE 0 END) > 0
            ORDER BY near_threshold_count DESC, transaction_count DESC
            LIMIT 20
        `;

        const groups = await runDuckQuery(groupQuery);

        // Apply optional riskLevel filter if compliance_reports view is available
        let filteredGroups = groups;
        if (filters?.riskLevel) {
            try {
                // Get risk levels from compliance reports
                const riskQuery = `
                    SELECT DISTINCT account_id 
                    FROM compliance_reports 
                    WHERE UPPER(risk_level) = '${String(filters.riskLevel).toUpperCase().replace(/'/g, "''")}'
                `;
                const riskAccounts = await runDuckQuery(riskQuery);
                const riskAccountSet = new Set(riskAccounts.map(r => String(r.account_id).toLowerCase()));

                filteredGroups = groups.filter(g =>
                    riskAccountSet.has(String(g.group_id).toLowerCase())
                );
            } catch (e) {
                // If compliance_reports doesn't have the right columns, skip filter
                console.warn("structuringDetector: could not apply riskLevel filter:", e.message);
            }
        }

        // Build result
        const candidates = filteredGroups.map(g => ({
            groupId: g.group_id,
            groupColumn: groupCol,
            transactionCount: Number(g.transaction_count),
            totalAmount: Number(g.total_amount),
            avgAmount: Number(g.avg_amount),
            minAmount: Number(g.min_amount),
            maxAmount: Number(g.max_amount),
            nearThresholdCount: Number(g.near_threshold_count)
        }));

        const rangeDesc = dateFilter
            ? `between ${dateFilter.start} and ${dateFilter.end}`
            : "in the full dataset";

        let summary;
        if (candidates.length === 0) {
            summary = `I found ${transactionsInRange} transactions ${rangeDesc}, but none met the configured structuring-pattern criteria (transactions with amounts between $9,000 and $10,000 in cash/deposit categories).`;
        } else {
            summary = `Found ${candidates.length} candidate structuring pattern(s) ${rangeDesc} across ${transactionsInRange} total transactions.`;
        }

        return {
            candidates,
            summary,
            transactionsInRange,
            dateRange: dateFilter ? { start: dateFilter.start, end: dateFilter.end } : null
        };
    } catch (err) {
        console.error("structuringDetector: query failed:", err.message);
        return { error: `Structuring detection query failed: ${err.message}` };
    }
}
