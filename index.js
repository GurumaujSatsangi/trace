import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import path from "path";
import "dotenv/config";
import { ChatGroq } from "@langchain/groq";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import duckdb from "duckdb";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up EJS view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Initialize Groq Chat Model
const model = new ChatGroq({
    apiKey: process.env.API_KEY,
    model: "llama-3.3-70b-versatile",
    temperature: 0,
});

// Initialize in-memory DuckDB instance
const db = new duckdb.Database(':memory:');

// Helper function to run DuckDB queries with async/await
const runDuckQuery = (sqlQuery) => {
    return new Promise((resolve, reject) => {
        db.all(sqlQuery, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
};

// Render the EJS frontend at the root route
app.get("/", (req, res) => {
    res.render("home");
});

// Natural Language to SQL & Execution Endpoint
app.post("/api/chat", async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Message content is required." });
        }

        const systemPrompt = `You are an expert Text-to-SQL engine for DuckDB. 
The user has a local transactions dataset stored at 'data/transactions.csv'.
The schema for this CSV file is:
- transaction_id (VARCHAR)
- account_id (VARCHAR)
- customer_name (VARCHAR)
- amount (DOUBLE)
- currency (VARCHAR)
- transaction_type (VARCHAR)
- timestamp (VARCHAR)
- location (VARCHAR)

Your task is to read the user's natural language question and write a valid DuckDB SQL query to answer it.
CRITICAL INSTRUCTIONS:
- Return ONLY the raw SQL query string.
- Do NOT include markdown code blocks (like \`\`\`sql).
- Do NOT include explanations, greetings, or extra text.
- Always query from 'data/transactions.csv'.`;

        const aiResponse = await model.invoke([
            new SystemMessage(systemPrompt),
            new HumanMessage(message)
        ]);

        let generatedSql = aiResponse.content.trim();
        generatedSql = generatedSql.replace(/^```sql\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");

        console.log(`[NL-to-SQL] User Query: "${message}"`);
        console.log(`[NL-to-SQL] Generated SQL: ${generatedSql}`);

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

        res.json({
            success: true,
            query: message,
            sql: generatedSql,
            results: queryResults,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ error: "Internal server error during NL-to-SQL pipeline." });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`TRACE backend server running on port http://localhost:${PORT}`);
});