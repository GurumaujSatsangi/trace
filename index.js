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
    apiKey: process.env.API_KEY,
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

app.post("/api/chat", async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: "Please provide a message to analyse." });
        }

        await refreshDuckView();

        const getColumnsWithTypes = (rows) => {
            if (!rows || rows.length === 0) return "";
            return Object.entries(rows[0]).map(([k, v]) => `${k} (${typeof v})`).join(", ");
        };

        const sampleRowsTx = await runDuckQuery("SELECT * FROM transactions LIMIT 1");
        const txColumns = getColumnsWithTypes(sampleRowsTx);

        let reportsColumns = "";
        try {
            const sampleRowsRep = await runDuckQuery("SELECT * FROM compliance_reports LIMIT 1");
            reportsColumns = getColumnsWithTypes(sampleRowsRep);
        } catch (e) {}

        const sqlSystemPrompt = `You are an expert Text-to-SQL engine for DuckDB.
The database has two tables:
1. transactions: ${txColumns}
2. compliance_reports: ${reportsColumns}
Write a valid DuckDB SQL query that answers the user's request.
IMPORTANT: DO NOT use SELECT *. You MUST select only the specific columns needed to answer the question, as the full rows are too large for the context window (especially avoid graph_state and enrichment_data). Always include identifying columns like account_id and transaction_id so the context is clear.
CRITICAL: ALWAYS use ILIKE for ALL string comparisons (e.g., transaction_id ILIKE 'txn0002', account_id ILIKE 'acc1002') to ensure case-insensitive matching, because database values may be uppercase.
CRITICAL: Fields marked as (boolean) must be queried with true/false, not strings. Do NOT use ILIKE on boolean fields.
Return ONLY the raw SQL query string with no markdown and no extra text.`;

        const sqlAiResponse = await model.invoke([
            new SystemMessage(sqlSystemPrompt),
            new HumanMessage(message)
        ]);

        const generatedSql = String(sqlAiResponse.content || "")
            .trim()
            .replace(/^```sql\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "");

        console.log("SQL Generated for chat query:", generatedSql);

        let queryResults;

        try {
            queryResults = await runDuckQuery(generatedSql);
        } catch (dbError) {
            let friendlyError = "I couldn't process this request due to a data format issue.";
            try {
                const errorPrompt = `The user asked: "${message}"\nThe generated SQL query failed with this technical error:\n${dbError.message}\n\nExplain why this failed in ONE simple, non-technical sentence that speaks directly to the user (e.g. "I cannot search for a name directly inside a list of links."). Do not mention SQL, databases, or technical terms like "Binder Error".`;
                const aiErrRes = await model.invoke([new HumanMessage(errorPrompt)]);
                friendlyError = aiErrRes.content.replace(/"/g, '').trim();
            } catch (e) {
                console.error("Failed to generate friendly error:", e);
            }
            return res.status(400).json({
                error: "SQL_ERROR",
                details: friendlyError
            });
        }

        if (queryResults.length === 0) {
            return res.json({
                success: true,
                query: message,
                sql: generatedSql,
                results: [],
                complianceVerdict: "I couldn't find any data matching your request in the current dataset. Please try broadening your search or checking your spelling.",
                timestamp: new Date().toISOString()
            });
        }

        const analysisSystemPrompt = `You are TRACE, an expert Anti-Money Laundering (AML) compliance officer.
User Question: "${message}"
Retrieved Data (Result of the database query for the user's question):
${JSON.stringify(queryResults, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2)}

Analyze these records for suspicious patterns and provide a professional compliance verdict.
CRITICAL: If the user asks for a list, table, or specific records, you MUST explicitly output the retrieved data in a clear HTML table (using <table>, <thead>, <tbody>, <tr>, <th>, <td>) or an HTML list (<ul>/<li>) before your analysis. Do NOT use markdown tables.
Note: The retrieved data directly corresponds to the User Question, even if certain identifying columns (like account_id) were omitted from the SQL SELECT clause.
Do not invent facts that are not present in the retrieved data.
Return the sources from news screening and PEP only when necessary.
Do NOT use asterisks (**) for bold formatting.`;

        const analysisAiResponse = await model.invoke([
            new SystemMessage(analysisSystemPrompt),
            new HumanMessage("Evaluate the retrieved data.")
        ]);

        const verdict = analysisAiResponse.content.replace(/\*\*/g, '');

        return res.json({
            success: true,
            query: message,
            sql: generatedSql,
            results: queryResults,
            complianceVerdict: verdict,
            timestamp: new Date().toISOString()
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