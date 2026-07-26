import express from "express";
import cors from "cors";
import path from "path";
import multer from "multer";
import fs from "fs";
import csv from "csv-parser";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import PDFDocument from "pdfkit";
import { graph } from "./agents/graph.js";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import duckdb from "duckdb";
import { resolveContext } from "./services/contextResolver.js";
import { buildQueryPlan } from "./services/queryPlanner.js";
import { resolveDateFilter, getTransactionSchema } from "./services/dateResolver.js";
import { detectStructuring } from "./services/structuringDetector.js";
import { formatGroundedResponse, formatNoResultMessage, validateReadOnlySql } from "./services/responseFormatter.js";

// DuckDB returns BigInts for some fields, which natively causes JSON.stringify to throw an error.
// This adds a `toJSON` method to all BigInts to safely convert them to strings during JSON serialization.
BigInt.prototype.toJSON = function () {
    return this.toString();
};

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDir = path.join(process.cwd(), "data");
const activeDatasetPath = path.join(uploadDir, "active_transactions.csv");
const activeDatasetDuckPath = activeDatasetPath.replace(/\\/g, "/");

const transactionColumns = [
    "transaction_id",
    "account_id",
    "customer_name",
    "amount",
    "currency",
    "transaction_type",
    "timestamp",
    "location",
    "sender_name",
    "beneficiary_name",
    "beneficiary_account",
    "sender_bank",
    "receiver_bank",
    "ip_address",
    "device_id",
    "country",
    "destination_country",
    "payment_method",
    "merchant",
    "channel",
    "exchange_rate",
    "usd_amount",
    "analysis_status",
    "uploaded_at"
];

const normalizeText = (value) => {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text === "" ? null : text;
};

const normalizeAmount = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeOptionalNumber = (value) => {
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const mapTransactionRow = (row) => {
    const transactionId = normalizeText(row.transaction_id ?? row.Transaction_ID);

    if (!transactionId) {
        return null;
    }

    return {
        transaction_id: transactionId,
        account_id: normalizeText(row.account_id ?? row.Account_ID),
        customer_name: normalizeText(row.customer_name ?? row.Customer_Name),
        amount: normalizeAmount(row.amount ?? row.Amount),
        currency: normalizeText(row.currency ?? row.Currency) || "USD",
        transaction_type: normalizeText(row.transaction_type ?? row.Transaction_Type),
        timestamp: normalizeText(row.timestamp ?? row.Timestamp) || new Date().toISOString(),
        location: normalizeText(row.location ?? row.Location),
        sender_name: normalizeText(row.sender_name ?? row.Sender_Name),
        beneficiary_name: normalizeText(row.beneficiary_name ?? row.Beneficiary_Name),
        beneficiary_account: normalizeText(row.beneficiary_account ?? row.Beneficiary_Account),
        sender_bank: normalizeText(row.sender_bank ?? row.Sender_Bank),
        receiver_bank: normalizeText(row.receiver_bank ?? row.Receiver_Bank),
        ip_address: normalizeText(row.ip_address ?? row.IP_Address),
        device_id: normalizeText(row.device_id ?? row.Device_ID),
        country: normalizeText(row.country ?? row.Country),
        destination_country: normalizeText(row.destination_country ?? row.Destination_Country),
        payment_method: normalizeText(row.payment_method ?? row.Payment_Method),
        merchant: normalizeText(row.merchant ?? row.Merchant),
        channel: normalizeText(row.channel ?? row.Channel),
        exchange_rate: normalizeOptionalNumber(row.exchange_rate ?? row.Exchange_Rate),
        usd_amount: normalizeOptionalNumber(row.usd_amount ?? row.USD_Amount),
        analysis_status: normalizeText(row.analysis_status ?? row.Analysis_Status) || "UPLOADED",
        uploaded_at: normalizeText(row.uploaded_at ?? row.Uploaded_At) || new Date().toISOString()
    };
};

const parseCsvFile = (filePath) => new Promise((resolve, reject) => {
    const results = [];

    fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (row) => {
            const mappedRow = mapTransactionRow(row);
            if (mappedRow) {
                results.push(mappedRow);
            }
        })
        .on("end", () => resolve(results))
        .on("error", reject);
});

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.set("views", path.join(process.cwd(), "views"));
app.set("view engine", "ejs");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, _file, cb) => cb(null, "active_transactions.csv")
});

const upload = multer({ storage });

const model = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    modelName: "gpt-4o",
    temperature: 0
});

const db = new duckdb.Database(":memory:");

const runDuckQuery = (sqlQuery) => new Promise((resolve, reject) => {
    db.all(sqlQuery, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

const runDuckStatement = (sqlStatement) => new Promise((resolve, reject) => {
    db.run(sqlStatement, (err) => {
        if (err) reject(err);
        else resolve();
    });
});

const refreshDuckView = async () => {
    if (!fs.existsSync(activeDatasetPath)) {
        throw new Error("Please upload a transaction CSV file first.");
    }

    const escapedPath = activeDatasetDuckPath.replace(/'/g, "''");

    const { data: reports } = await supabase.from('compliance_reports').select('*');
    if (reports) {
        const reportsPath = path.join(uploadDir, "compliance_reports.json");
        fs.writeFileSync(reportsPath, JSON.stringify(reports));
        const escapedReportsPath = reportsPath.replace(/\\/g, "/").replace(/'/g, "''");
        await runDuckStatement(`
            CREATE OR REPLACE TEMP VIEW compliance_reports AS
            SELECT * FROM read_json_auto('${escapedReportsPath}')
        `);
    }

    await runDuckStatement(`
        CREATE OR REPLACE TEMP VIEW transactions AS
        SELECT * FROM read_csv_auto('${escapedPath}', HEADER = TRUE)
    `);
};

app.get("/", (_req, res) => {
    return res.render("home");
});

app.post("/api/upload", upload.single("csvFile"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded. Please attach a CSV file under the 'csvFile' field." });
    }

    try {
        console.log("CSV Uploaded");
        const results = await parseCsvFile(req.file.path);

        if (results.length === 0) {
            return res.status(400).json({ error: "The uploaded CSV did not contain any valid transaction rows." });
        }

        const { error: upsertError } = await supabase
            .from("transactions")
            .upsert(results, { onConflict: "transaction_id" });

        if (upsertError) {
            throw upsertError;
        }

        console.log("Transactions Inserted");

        const uploadedIds = results.map((row) => row.transaction_id);

        const { data: uploadedTransactions, error: fetchError } = await supabase
            .from("transactions")
            .select("*")
            .in("transaction_id", uploadedIds);

        if (fetchError) {
            throw fetchError;
        }

        if (!Array.isArray(uploadedTransactions) || uploadedTransactions.length === 0) {
            throw new Error("Uploaded transactions could not be fetched back from Supabase.");
        }

        const graphResult = await graph.invoke({
            transactions: uploadedTransactions,
            query_prompt: "CSV Upload Analysis",
            sql_generated: null,
            startedAt: new Date().toISOString()
        });

        return res.json({
            success: true,
            message: "CSV uploaded, transactions analysed, and compliance reports saved.",
            totalInserted: results.length,
            analysed: uploadedTransactions.length,
            graph: graphResult
        });
    } catch (error) {
        console.error("Upload processing failed:", error);
        return res.status(500).json({
            error: "Failed to process the uploaded CSV file.",
            details: error.message
        });
    }
});

app.get("/api/reports", async (req, res) => {
    try {
        const { data, error } = await supabase.from('compliance_reports').select('*');
        if (error) throw error;
        return res.json({ success: true, reports: data });
    } catch (err) {
        console.error("Error fetching reports:", err);
        return res.status(500).json({ error: "Failed to fetch reports" });
    }
});

app.get("/api/transactions/:account_id", async (req, res) => {
    try {
        const accountId = req.params.account_id;
        const { data, error } = await supabase.from('transactions').select('*').eq('account_id', accountId);
        if (error) throw error;
        return res.json({ success: true, transactions: data });
    } catch (err) {
        console.error("Error fetching transactions:", err);
        return res.status(500).json({ error: "Failed to fetch transactions" });
    }
});

// --- History validation helper ---
function validateAndLimitHistory(history) {
    if (!Array.isArray(history)) return [];

    const MAX_MESSAGES = 12;
    const MAX_CONTENT_LENGTH = 2000;
    const allowedRoles = new Set(["user", "assistant"]);

    return history
        .filter(item =>
            item &&
            typeof item === "object" &&
            allowedRoles.has(item.role) &&
            typeof item.content === "string" &&
            item.content.trim().length > 0
        )
        .slice(-MAX_MESSAGES)
        .map(item => ({
            role: item.role,
            content: item.content.length > MAX_CONTENT_LENGTH
                ? item.content.slice(0, MAX_CONTENT_LENGTH)
                : item.content
        }));
}

// --- Helper: get column info for SQL generation ---
function getColumnsWithTypes(rows) {
    if (!rows || rows.length === 0) return "";
    return Object.entries(rows[0]).map(([k, v]) => `${k} (${typeof v})`).join(", ");
}

// --- Execute a query plan ---
async function executeQueryPlan(plan, { runDuckQuery, model }) {
    const toolsExecuted = [];
    const toolsSkipped = [];
    let evidence = {};

    // Determine which tools to skip based on what's NOT in the plan
    const allPossibleTools = [
        "date_resolver", "transaction_lookup", "customer_lookup",
        "risk_lookup", "structuring_detector", "transaction_filter",
        "sql_aggregate", "sql_generate", "sql_validate", "sql_execute",
        "schema_summary"
    ];
    const plannedToolSet = new Set(plan.tools);
    for (const t of allPossibleTools) {
        if (!plannedToolSet.has(t)) toolsSkipped.push(t);
    }

    // --- Tool: date_resolver ---
    if (plannedToolSet.has("date_resolver") && plan.filters?.dateExpression) {
        toolsExecuted.push("date_resolver");
        const dateResult = await resolveDateFilter({
            dateExpression: plan.filters.dateExpression,
            runDuckQuery
        });
        if (dateResult.error) {
            return { evidence: { error: dateResult.error }, toolsExecuted, toolsSkipped };
        }
        evidence.dateFilter = dateResult;
    }

    // --- Tool: transaction_lookup ---
    if (plannedToolSet.has("transaction_lookup") && plan.entities?.transaction_id) {
        toolsExecuted.push("transaction_lookup");
        const txId = String(plan.entities.transaction_id).replace(/'/g, "''");
        try {
            const rows = await runDuckQuery(
                `SELECT transaction_id, account_id, customer_name, amount, currency, transaction_type, timestamp, location, country, destination_country, sender_name, beneficiary_name, payment_method, channel
                 FROM transactions WHERE transaction_id ILIKE '${txId}'`
            );
            if (rows.length === 0) {
                return {
                    evidence: { notFound: true, entityType: "transaction", entityId: plan.entities.transaction_id },
                    toolsExecuted,
                    toolsSkipped
                };
            }
            evidence.transaction = rows[0];
            evidence.transactionRows = rows;
        } catch (err) {
            evidence.transactionError = err.message;
        }
    }

    // --- Tool: customer_lookup ---
    if (plannedToolSet.has("customer_lookup")) {
        toolsExecuted.push("customer_lookup");
        const lookupField = plan.entities?.account_id ? "account_id" : plan.entities?.customer_name ? "customer_name" : null;
        const lookupVal = plan.entities?.account_id || plan.entities?.customer_name;

        if (lookupField && lookupVal) {
            const safeVal = String(lookupVal).replace(/'/g, "''");
            try {
                const rows = await runDuckQuery(
                    `SELECT transaction_id, account_id, customer_name, amount, currency, transaction_type, timestamp, country, destination_country
                     FROM transactions WHERE ${lookupField} ILIKE '%${safeVal}%'
                     ORDER BY timestamp DESC LIMIT 50`
                );
                if (rows.length === 0) {
                    return {
                        evidence: { notFound: true, entityType: lookupField, entityId: lookupVal },
                        toolsExecuted,
                        toolsSkipped
                    };
                }
                evidence.customerTransactions = rows;
            } catch (err) {
                evidence.customerError = err.message;
            }
        }
    }

    // --- Tool: risk_lookup ---
    if (plannedToolSet.has("risk_lookup")) {
        toolsExecuted.push("risk_lookup");
        try {
            // Try to get compliance report data
            const txId = plan.entities?.transaction_id;
            const accountId = plan.entities?.account_id;

            if (txId) {
                const safeTxId = String(txId).replace(/'/g, "''");
                const riskRows = await runDuckQuery(
                    `SELECT * FROM compliance_reports WHERE transaction_id ILIKE '${safeTxId}'`
                );
                if (riskRows.length > 0) {
                    evidence.complianceReport = riskRows[0];
                }
            } else if (accountId) {
                const safeAccId = String(accountId).replace(/'/g, "''");
                const riskRows = await runDuckQuery(
                    `SELECT * FROM compliance_reports WHERE account_id ILIKE '${safeAccId}'`
                );
                if (riskRows.length > 0) {
                    evidence.complianceReports = riskRows;
                }
            }
        } catch (err) {
            // compliance_reports may not exist or have different schema
            console.warn("risk_lookup: could not query compliance_reports:", err.message);
        }
    }

    // --- Tool: transaction_filter (for layering/risk pattern search) ---
    if (plannedToolSet.has("transaction_filter")) {
        toolsExecuted.push("transaction_filter");
        const whereClauses = [];

        if (evidence.dateFilter) {
            whereClauses.push(
                `"${evidence.dateFilter.timestampColumn}"::TIMESTAMP >= '${evidence.dateFilter.start}'::TIMESTAMP AND "${evidence.dateFilter.timestampColumn}"::TIMESTAMP <= '${evidence.dateFilter.end}'::TIMESTAMP`
            );
        }

        const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

        try {
            const rows = await runDuckQuery(
                `SELECT transaction_id, account_id, customer_name, amount, currency, transaction_type, timestamp, country, destination_country, beneficiary_name, sender_name
                 FROM transactions ${whereStr}
                 ORDER BY timestamp DESC LIMIT 200`
            );
            evidence.filteredTransactions = rows;
        } catch (err) {
            evidence.filterError = err.message;
        }
    }

    // --- Tool: structuring_detector ---
    if (plannedToolSet.has("structuring_detector")) {
        toolsExecuted.push("structuring_detector");
        const result = await detectStructuring({
            dateFilter: evidence.dateFilter || null,
            filters: plan.filters,
            runDuckQuery
        });
        evidence.structuringResult = result;
    }

    // --- Tool: sql_aggregate ---
    if (plannedToolSet.has("sql_aggregate")) {
        toolsExecuted.push("sql_aggregate");

        // Use LLM to generate appropriate aggregate SQL
        const sampleRowsTx = await runDuckQuery("SELECT * FROM transactions LIMIT 1");
        const txColumns = getColumnsWithTypes(sampleRowsTx);

        let reportsColumns = "";
        try {
            const sampleRowsRep = await runDuckQuery("SELECT * FROM compliance_reports LIMIT 1");
            reportsColumns = getColumnsWithTypes(sampleRowsRep);
        } catch (e) { }

        const sqlPrompt = `You are an expert Text-to-SQL engine for DuckDB.
The database has two tables:
1. transactions: ${txColumns}
2. compliance_reports: ${reportsColumns}
Write a valid DuckDB SQL query that answers the user's request.
IMPORTANT: DO NOT use SELECT *. Select only specific columns needed.
CRITICAL: Use ILIKE for string comparisons. Boolean fields use true/false not strings.
CRITICAL: For relative dates, use: WHERE timestamp >= (SELECT MAX(timestamp)::TIMESTAMP - INTERVAL 'N days' FROM transactions).
Return ONLY the raw SQL query string with no markdown and no extra text.`;

        try {
            const sqlResponse = await model.invoke([
                new SystemMessage(sqlPrompt),
                new HumanMessage(plan.resolvedQuery)
            ]);

            let generatedSql = String(sqlResponse.content || "")
                .trim()
                .replace(/^```sql\s*/i, "")
                .replace(/^```\s*/i, "")
                .replace(/\s*```$/i, "");

            // Validate SQL is read-only
            const validation = validateReadOnlySql(generatedSql);
            if (!validation.valid) {
                evidence.sqlError = validation.error;
            } else {
                const rows = await runDuckQuery(generatedSql);
                evidence.sqlResults = rows;
                evidence.generatedSql = generatedSql;
            }
        } catch (err) {
            evidence.sqlError = err.message;
        }
    }

    // --- Tool: schema_summary (for broad_eda) ---
    if (plannedToolSet.has("schema_summary")) {
        toolsExecuted.push("schema_summary");
        try {
            const schema = await getTransactionSchema(runDuckQuery);
            const countResult = await runDuckQuery("SELECT COUNT(*) AS cnt FROM transactions");
            evidence.schemaSummary = {
                columns: schema,
                totalRows: Number(countResult[0]?.cnt || 0)
            };

            // Get basic stats
            const statsQuery = `SELECT 
                COUNT(*) AS total_transactions,
                COUNT(DISTINCT account_id) AS unique_accounts,
                ROUND(SUM(CAST(amount AS DOUBLE)), 2) AS total_amount,
                ROUND(AVG(CAST(amount AS DOUBLE)), 2) AS avg_amount,
                ROUND(MIN(CAST(amount AS DOUBLE)), 2) AS min_amount,
                ROUND(MAX(CAST(amount AS DOUBLE)), 2) AS max_amount
            FROM transactions`;
            const stats = await runDuckQuery(statsQuery);
            if (stats.length > 0) evidence.datasetStats = stats[0];
        } catch (err) {
            evidence.schemaError = err.message;
        }
    }

    // --- Tools: sql_generate + sql_validate + sql_execute (controlled SQL fallback) ---
    if (plannedToolSet.has("sql_generate")) {
        toolsExecuted.push("sql_generate");

        const sampleRowsTx = await runDuckQuery("SELECT * FROM transactions LIMIT 1");
        const txColumns = getColumnsWithTypes(sampleRowsTx);

        let reportsColumns = "";
        try {
            const sampleRowsRep = await runDuckQuery("SELECT * FROM compliance_reports LIMIT 1");
            reportsColumns = getColumnsWithTypes(sampleRowsRep);
        } catch (e) { }

        const sqlPrompt = `You are an expert Text-to-SQL engine for DuckDB.
The database has two tables:
1. transactions: ${txColumns}
2. compliance_reports: ${reportsColumns}
Write a valid DuckDB SQL query that answers the user's request.
IMPORTANT: DO NOT use SELECT *. Select only specific columns needed.
CRITICAL: Use ILIKE '%...%' with wildcards for string/text comparisons to allow partial matches. Boolean fields use true/false not strings.
CRITICAL: For relative dates, use: WHERE timestamp >= (SELECT MAX(timestamp)::TIMESTAMP - INTERVAL 'N days' FROM transactions).
Return ONLY the raw SQL query string with no markdown and no extra text.`;

        try {
            const sqlResponse = await model.invoke([
                new SystemMessage(sqlPrompt),
                new HumanMessage(plan.resolvedQuery)
            ]);

            let generatedSql = String(sqlResponse.content || "")
                .trim()
                .replace(/^```sql\s*/i, "")
                .replace(/^```\s*/i, "")
                .replace(/\s*```$/i, "");

            // sql_validate
            toolsExecuted.push("sql_validate");
            const validation = validateReadOnlySql(generatedSql);
            if (!validation.valid) {
                evidence.sqlError = validation.error;
            } else {
                // sql_execute
                toolsExecuted.push("sql_execute");
                const rows = await runDuckQuery(generatedSql);
                evidence.sqlResults = rows;
                evidence.generatedSql = generatedSql;
            }
        } catch (err) {
            evidence.sqlError = err.message;
        }
    }

    return { evidence, toolsExecuted, toolsSkipped };
}

// ========================
// /api/chat — main handler
// ========================
app.post("/api/chat", async (req, res) => {
    try {
        const { message, history = [] } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: "Please provide a message to analyse." });
        }

        const safeHistory = validateAndLimitHistory(history);

        // --- Context / intent resolution (always runs, even first turn) ---
        const resolvedRequest = await resolveContext({
            message,
            history: safeHistory,
            model
        });

        console.log("Resolved context:", JSON.stringify(resolvedRequest, null, 2));

        // --- Build query plan ---
        const plan = buildQueryPlan(resolvedRequest);

        console.log("Query plan:", JSON.stringify({ path: plan.path, intent: plan.intent, tools: plan.tools }, null, 2));

        // --- Direct responses (greeting, out_of_scope, clarification) — NO SQL, NO DuckDB ---
        if (plan.path === "direct_response" || plan.path === "clarification") {
            const executionMeta = {
                intent: plan.intent,
                inheritedContext: resolvedRequest.inheritedContext,
                filters: resolvedRequest.filters,
                toolsExecuted: [],
                toolsSkipped: ["date_resolver", "transaction_lookup", "customer_lookup", "risk_lookup", "structuring_detector", "sql_generate", "sql_execute"]
            };
            console.log("Execution metadata:", JSON.stringify(executionMeta, null, 2));

            return res.json({
                success: true,
                query: message,
                results: [],
                complianceVerdict: plan.directResponse,
                timestamp: new Date().toISOString(),
                executionMeta
            });
        }

        // --- For all other paths, refresh DuckDB view ---
        await refreshDuckView();

        // --- Execute the plan ---
        const { evidence, toolsExecuted, toolsSkipped } = await executeQueryPlan(plan, { runDuckQuery, model });

        const executionMeta = {
            intent: plan.intent,
            inheritedContext: resolvedRequest.inheritedContext,
            filters: resolvedRequest.filters,
            toolsExecuted,
            toolsSkipped
        };

        console.log("Execution metadata:", JSON.stringify(executionMeta, null, 2));

        // --- Handle not-found entities ---
        if (evidence.notFound) {
            const noResultMsg = formatNoResultMessage({
                intent: plan.intent,
                entities: plan.entities,
                filters: plan.filters,
                dateFilter: evidence.dateFilter,
                context: "not_found"
            });
            return res.json({
                success: true,
                query: message,
                results: [],
                complianceVerdict: noResultMsg,
                timestamp: new Date().toISOString(),
                executionMeta
            });
        }

        // --- Handle errors ---
        if (evidence.error) {
            return res.json({
                success: true,
                query: message,
                results: [],
                complianceVerdict: evidence.error,
                timestamp: new Date().toISOString(),
                executionMeta
            });
        }

        if (evidence.sqlError) {
            let friendlyError = evidence.sqlError;
            try {
                const errorPrompt = `The user asked: "${message}"\nThe generated SQL query failed with this technical error:\n${evidence.sqlError}\n\nExplain why this failed in ONE simple, non-technical sentence that speaks directly to the user. Do not mention SQL, databases, or technical terms.`;
                const aiErrRes = await model.invoke([new HumanMessage(errorPrompt)]);
                friendlyError = aiErrRes.content.replace(/"/g, '').trim();
            } catch (e) { }
            return res.status(400).json({
                error: "SQL_ERROR",
                details: friendlyError
            });
        }

        // --- Handle structuring results ---
        if (evidence.structuringResult) {
            const sr = evidence.structuringResult;
            if (sr.error) {
                return res.json({
                    success: true,
                    query: message,
                    results: [],
                    complianceVerdict: sr.error,
                    timestamp: new Date().toISOString(),
                    executionMeta
                });
            }

            if (sr.candidates.length === 0) {
                const noResultMsg = formatNoResultMessage({
                    intent: plan.intent,
                    entities: plan.entities,
                    filters: plan.filters,
                    dateFilter: evidence.dateFilter,
                    context: "no_candidates"
                });
                return res.json({
                    success: true,
                    query: message,
                    results: [],
                    complianceVerdict: noResultMsg,
                    timestamp: new Date().toISOString(),
                    executionMeta
                });
            }

            // Format structuring evidence for the LLM
            const structuringEvidence = {
                ...sr,
                analysisType: "candidate_structuring_indicators",
                note: "These are accounts demonstrating near-threshold activity based on the single-transaction indicator (amounts $9,000-$9,999 in cash/deposit categories), rather than a confirmed sequence structuring pattern."
            };

            const verdict = await formatGroundedResponse({
                originalMessage: message,
                resolvedQuery: plan.resolvedQuery,
                intent: plan.intent,
                evidence: structuringEvidence,
                model
            });

            return res.json({
                success: true,
                query: message,
                results: sr.candidates,
                complianceVerdict: verdict,
                timestamp: new Date().toISOString(),
                executionMeta
            });
        }

        // --- Build evidence for LLM response ---
        const combinedEvidence = {};
        if (evidence.transaction) combinedEvidence.transaction = evidence.transaction;
        if (evidence.transactionRows) combinedEvidence.transactionRows = evidence.transactionRows;
        if (evidence.customerTransactions) combinedEvidence.customerTransactions = evidence.customerTransactions;
        if (evidence.complianceReport) combinedEvidence.complianceReport = evidence.complianceReport;
        if (evidence.complianceReports) combinedEvidence.complianceReports = evidence.complianceReports;
        if (evidence.sqlResults) combinedEvidence.queryResults = evidence.sqlResults;
        if (evidence.filteredTransactions) combinedEvidence.filteredTransactions = evidence.filteredTransactions;
        if (evidence.schemaSummary) combinedEvidence.schemaSummary = evidence.schemaSummary;
        if (evidence.datasetStats) combinedEvidence.datasetStats = evidence.datasetStats;
        if (evidence.dateFilter) combinedEvidence.dateRange = { start: evidence.dateFilter.start, end: evidence.dateFilter.end };

        // Check if we have any actual evidence
        const hasEvidence = Object.keys(combinedEvidence).some(k => {
            const val = combinedEvidence[k];
            if (Array.isArray(val)) return val.length > 0;
            if (typeof val === "object" && val !== null) return Object.keys(val).length > 0;
            return val !== null && val !== undefined;
        });

        if (!hasEvidence) {
            const noResultMsg = formatNoResultMessage({
                intent: plan.intent,
                entities: plan.entities,
                filters: plan.filters,
                dateFilter: evidence.dateFilter,
                context: "empty_results"
            });
            return res.json({
                success: true,
                query: message,
                results: [],
                complianceVerdict: noResultMsg,
                timestamp: new Date().toISOString(),
                executionMeta
            });
        }

        // --- Generate grounded response ---
        const verdict = await formatGroundedResponse({
            originalMessage: message,
            resolvedQuery: plan.resolvedQuery,
            intent: plan.intent,
            evidence: combinedEvidence,
            model
        });

        // Build results array for UI table rendering
        const resultsForUi = evidence.sqlResults || evidence.transactionRows || evidence.customerTransactions || [];

        return res.json({
            success: true,
            query: message,
            sql: evidence.generatedSql || null,
            results: resultsForUi,
            complianceVerdict: verdict,
            timestamp: new Date().toISOString(),
            executionMeta
        });

    } catch (error) {
        console.error("Error processing chat request:", error);

        if (error.message && error.message.includes("429")) {
            let retryAfterSeconds = 15;
            const match = error.message.match(/try again in (?:([0-9]+)m)?([0-9\.]+)s/);
            if (match) {
                const minutes = match[1] ? parseFloat(match[1]) : 0;
                const seconds = parseFloat(match[2]);
                retryAfterSeconds = Math.ceil((minutes * 60) + seconds);
            }
            return res.status(429).json({ error: "RATE_LIMIT", retryAfter: retryAfterSeconds });
        }

        return res.status(500).json({ error: "Internal server error during processing.", details: error.message });
    }
});

// ========================
// /api/analytics/summary — schema-aware dataset analytics
// ========================
app.get("/api/analytics/summary", async (_req, res) => {
    try {
        await refreshDuckView();

        const schema = await getTransactionSchema(runDuckQuery);
        if (!schema || schema.length === 0) {
            return res.json({ success: true, availableMetrics: [], message: "No active dataset." });
        }

        const columnNames = new Set(schema.map(c => c.column_name.toLowerCase()));
        const result = {};
        const availableMetrics = [];

        // Total transactions (always available)
        const countResult = await runDuckQuery("SELECT COUNT(*) AS cnt FROM transactions");
        result.totalTransactions = Number(countResult[0]?.cnt || 0);
        availableMetrics.push("totalTransactions");

        // Total amount (if amount column exists)
        if (columnNames.has("amount")) {
            try {
                const amtResult = await runDuckQuery(
                    "SELECT ROUND(SUM(CAST(amount AS DOUBLE)), 2) AS total FROM transactions"
                );
                result.totalAmount = Number(amtResult[0]?.total || 0);
                availableMetrics.push("totalAmount");
            } catch (e) { }
        }

        // Unique accounts (if account_id exists)
        if (columnNames.has("account_id")) {
            try {
                const accResult = await runDuckQuery(
                    "SELECT COUNT(DISTINCT account_id) AS cnt FROM transactions"
                );
                result.uniqueAccounts = Number(accResult[0]?.cnt || 0);
                availableMetrics.push("uniqueAccounts");
            } catch (e) { }
        }

        // Risk distribution (from compliance_reports if available)
        try {
            const riskResult = await runDuckQuery(`
                SELECT UPPER(risk_level) AS level, COUNT(*) AS cnt 
                FROM compliance_reports 
                WHERE risk_level IS NOT NULL 
                GROUP BY UPPER(risk_level)
            `);
            if (riskResult.length > 0) {
                const dist = {};
                let highCount = 0;
                for (const r of riskResult) {
                    dist[r.level] = Number(r.cnt);
                    if (r.level === "HIGH") highCount = Number(r.cnt);
                }
                result.riskDistribution = dist;
                result.highRiskCount = highCount;
                availableMetrics.push("riskDistribution", "highRiskCount");
            }
        } catch (e) { }

        // Transactions per day (if timestamp column exists)
        if (columnNames.has("timestamp")) {
            try {
                const timeResult = await runDuckQuery(`
                    SELECT CAST("timestamp" AS DATE) AS day, COUNT(*) AS cnt
                    FROM transactions
                    WHERE "timestamp" IS NOT NULL
                    GROUP BY CAST("timestamp" AS DATE)
                    ORDER BY day
                    LIMIT 90
                `);
                if (timeResult.length > 0) {
                    result.transactionsPerDay = timeResult.map(r => ({
                        day: String(r.day),
                        count: Number(r.cnt)
                    }));
                    availableMetrics.push("transactionsPerDay");
                }
            } catch (e) { }
        }

        // Transaction type distribution (if transaction_type exists)
        if (columnNames.has("transaction_type")) {
            try {
                const typeResult = await runDuckQuery(`
                    SELECT transaction_type AS type, COUNT(*) AS cnt
                    FROM transactions
                    WHERE transaction_type IS NOT NULL
                    GROUP BY transaction_type
                    ORDER BY cnt DESC
                    LIMIT 15
                `);
                if (typeResult.length > 0) {
                    const dist = {};
                    for (const r of typeResult) {
                        dist[r.type] = Number(r.cnt);
                    }
                    result.typeDistribution = dist;
                    availableMetrics.push("typeDistribution");
                }
            } catch (e) { }
        }

        result.availableMetrics = availableMetrics;
        result.success = true;

        return res.json(result);
    } catch (err) {
        console.error("Error generating analytics summary:", err);
        return res.json({ success: true, availableMetrics: [], message: "Could not load analytics. " + err.message });
    }
});

app.get("/api/transaction/:id", async (req, res) => {
    try {
        const txId = req.params.id;
        // Fetch full transaction and compliance report details
        const query = `
            SELECT t.*, cr.* EXCLUDE (transaction_id)
            FROM transactions t
            LEFT JOIN compliance_reports cr ON t.transaction_id = cr.transaction_id
            WHERE t.transaction_id ILIKE '${txId.replace(/'/g, "''")}'
        `;

        await refreshDuckView();
        const results = await runDuckQuery(query);

        if (results.length === 0) {
            return res.status(404).json({ error: "Transaction not found." });
        }

        return res.json({ success: true, transaction: results[0] });
    } catch (error) {
        console.error("Error fetching transaction details:", error);
        return res.status(500).json({ error: "Failed to fetch transaction details." });
    }
});

app.listen(PORT, () => {
    console.log(`TRACE server running on http://localhost:${PORT}`);
});