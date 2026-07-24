import express from "express";
import cors from "cors";
import "dotenv/config";
import { ChatGroq } from "@langchain/groq";
import { HumanMessage } from "@langchain/core/messages";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(cors());
app.use(express.json());

// Initialize the Groq Chat Model
const model = new ChatGroq({
    apiKey: process.env.API_KEY,
    model: "llama-3.3-70b-versatile",
    temperature: 0.2,
});

// Health check endpoint
app.get("/", (req, res) => {
    res.json({
        status: "online",
        system: "TRACE - Transaction Risk Analysis & Compliance Engine"
    });
});

app.post("/api/chat", async (req, res) => {
    try {
        const  {message} = req.body;

        if (!message) {
            return res.status(400).json({ error: "Message content is required." });
        }

        const response = await model.invoke([new HumanMessage(message)]);

        res.json({
            query: message,
            reply: response.content,
            model: "llama-3.3-70b-versatile",
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("Error communicating with Groq API:", error);
        res.status(500).json({ error: "Failed to fetch response from Groq API." });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`TRACE backend server running on port ${PORT}`);
});