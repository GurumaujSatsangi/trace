import express from "express";
import cors from "cors";
import path from "path";
import multer from "multer";
import fs from "fs";
import csv from "csv-parser";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import { ChatGroq } from "@langchain/groq";
import { graph } from "./agents/graph.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import duckdb from "duckdb";

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

const model = new ChatGroq({
    apiKey: process.env.API_KEY,
    model: "llama-3.3-70b-versatile",
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

    await runDuckStatement(`
        CREATE OR REPLACE TEMP VIEW active_transactions AS
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

app.post("/api/chat", async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: "Please provide a message to analyse." });
        }

        await refreshDuckView();

        const sqlSystemPrompt = `You are an expert Text-to-SQL engine for DuckDB.
The uploaded dataset is available as a DuckDB view named active_transactions.
The view contains these columns: ${transactionColumns.join(", ")}.
Write a valid DuckDB SQL query that answers the user's request.
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

        let queryResults;

        try {
            queryResults = await runDuckQuery(generatedSql);
        } catch (dbError) {
            return res.status(400).json({
                error: "Generated SQL execution failed.",
                sql: generatedSql,
                details: dbError.message
            });
        }

        const analysisSystemPrompt = `You are TRACE, an expert Anti-Money Laundering (AML) compliance officer.
User Question: "${message}"
Retrieved Data:
${JSON.stringify(queryResults, null, 2)}

Analyze these records for suspicious patterns and provide a professional compliance verdict.
Do not invent facts that are not present in the retrieved data.`;

        const analysisAiResponse = await model.invoke([
            new SystemMessage(analysisSystemPrompt),
            new HumanMessage("Evaluate the retrieved data.")
        ]);

        return res.json({
            success: true,
            query: message,
            sql: generatedSql,
            results: queryResults,
            complianceVerdict: analysisAiResponse.content,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("Error processing chat request:", error);
        return res.status(500).json({ error: "Internal server error during processing.", details: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`TRACE server running on http://localhost:${PORT}`);
});