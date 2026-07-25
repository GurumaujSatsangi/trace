import express from "express";
import cors from "cors";
import path from "path";
import multer from "multer";
import fs from "fs";
import csv from "csv-parser";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import { ChatGroq } from "@langchain/groq";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import duckdb from "duckdb";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure Multer storage for uploaded CSV files
const uploadDir = path.join(process.cwd(), "data");
if (!fs.existsSync(uploadDir)) {
    fs.existsSync(uploadDir) || fs.mkdirSync(uploadDir, { recursive: true });
}

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);


const upload = multer({ dest: uploadDir });

// CSV Upload & Supabase Insertion Route
app.post("/api/upload", upload.single("csvFile"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded. Please attach a CSV file under the 'csvFile' field." });
    }

    const filePath = req.file.path;
    const results = [];

    // 1. Read and parse the CSV file stream
    fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (data) => {
            // Map CSV columns to match your Supabase 'transactions' table schema
            results.push({
                transaction_id: data.transaction_id || data.Transaction_ID,
                account_id: data.account_id || data.Account_ID,
                customer_name: data.customer_name || data.Customer_Name,
                amount: parseFloat(data.amount || data.Amount || 0),
                currency: data.currency || data.Currency || 'USD',
                transaction_type: data.transaction_type || data.Transaction_Type,
                timestamp: data.timestamp || data.Timestamp || new Date().toISOString(),
                location: data.location || data.Location
            });
        })
        .on("end", async () => {
            try {
                // 2. Bulk upsert/insert the parsed rows into Supabase 'transactions' table
                const { data, error } = await supabase
                    .from("transactions")
                    .upsert(results, { onConflict: "transaction_id" });

                if (error) {
                    throw error;
                }

                // 3. Clean up the local temporary file
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }

                res.json({
                    success: true,
                    message: `Successfully parsed and uploaded ${results.length} records to Supabase!`,
                    totalInserted: results.length
                });

            } catch (dbError) {
                console.error("Supabase Insertion Error:", dbError);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                res.status(500).json({ 
                    error: "Failed to insert records into Supabase.", 
                    details: dbError.message 
                });
            }
        })
        .on("error", (err) => {
            console.error("CSV Parsing Error:", err);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            res.status(500).json({ error: "Failed to parse the uploaded CSV file." });
        });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Save uploaded file with a fixed name for easy querying, or keep original name
        cb(null, "active_transactions.csv");
    }
});

// Initialize Groq & DuckDB
const model = new ChatGroq({
    apiKey: process.env.API_KEY,
    model: "llama-3.3-70b-versatile",
    temperature: 0,
});

const db = new duckdb.Database(':memory:');

const runDuckQuery = (sqlQuery) => {
    return new Promise((resolve, reject) => {
        db.all(sqlQuery, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// 1. Endpoint to handle CSV file uploads from the frontend
// app.post("/api/upload", upload.single("csvFile"), (req, res) => {
//     if (!req.file) {
//         return res.status(400).json({ error: "No file uploaded." });
//     }
//     res.json({
//         success: true,
//         message: "Dataset uploaded successfully!",
//         filename: req.file.originalname
//     });
// });

// 2. Chat & Compliance Analysis Endpoint
app.post("/api/chat", async (req, res) => {
    try {
        const { message } = req.body;
        const activeDatasetPath = "data/active_transactions.csv";

        if (!fs.existsSync(activeDatasetPath)) {
            return res.status(400).json({ error: "Please upload a transaction CSV file first." });
        }

        // Step A: Generate SQL from natural language targeting the active uploaded file
        const sqlSystemPrompt = `You are an expert Text-to-SQL engine for DuckDB. 
The user's dataset is stored at '${activeDatasetPath}'.
Write a valid DuckDB SQL query to answer the user's request.
Return ONLY the raw SQL query string. No markdown formatting, no extra text.`;

        const sqlAiResponse = await model.invoke([
            new SystemMessage(sqlSystemPrompt),
            new HumanMessage(message)
        ]);

        let generatedSql = sqlAiResponse.content.trim();
        generatedSql = generatedSql.replace(/^```sql\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");

        // Step B: Execute query against DuckDB
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

        // Step C: Analyze results for compliance risks
        const analysisSystemPrompt = `You are TRACE, an expert Anti-Money Laundering (AML) compliance officer.
User Question: "${message}"
Retrieved Data:
${JSON.stringify(queryResults, null, 2)}

Analyze these records for suspicious patterns (like structuring, high velocity, or anomalies) and provide a professional compliance verdict.`;

        const analysisAiResponse = await model.invoke([
            new SystemMessage(analysisSystemPrompt),
            new HumanMessage("Evaluate the retrieved data.")
        ]);

        res.json({
            success: true,
            query: message,
            sql: generatedSql,
            results: queryResults,
            complianceVerdict: analysisAiResponse.content,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ error: "Internal server error during processing." });
    }
});

app.listen(PORT, () => {
    console.log(`TRACE server running on http://localhost:${PORT}`);
});