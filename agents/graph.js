import { StateGraph, START, END } from "@langchain/langgraph";
import { TransactionState } from "../state/transactionState.js";

import {
    loadTransactionsAgent,
    openSanctionsAgent,
    ipIntelAgent,
    exchangeRateAgent,
    adverseMediaAgent,
    mergeEnrichmentAgent
} from "./enrichmentAgent.js";
import { qualityAssuranceAgent } from "./qualityAssuranceAgent.js";
import { investigationAgent } from "./investigationAgent.js";
import { decisionAgent } from "./decisionAgent.js";
import { saveReportsAgent } from "./saveReportsAgent.js";

function qaRouter(state) {
    const reports = Array.isArray(state.reports) ? state.reports : [];

    let hasHigh = false;
    let hasMedium = false;

    for (const report of reports) {
        const level = String(report.qa?.risk_level || "").toUpperCase();
        const score = Number(report.qa?.risk_score ?? 0);
        if (level === "HIGH" || score >= 70) {
            hasHigh = true;
        } else if (level === "MEDIUM" || score >= 40) {
            hasMedium = true;
        }
    }

    if (hasHigh) return "HIGH";
    if (hasMedium) return "MEDIUM";
    return "LOW";
}

const workflow = new StateGraph(TransactionState);

// Register Nodes with unique names (distinct from state channels)
workflow.addNode("loadTransactionsNode", loadTransactionsAgent);
workflow.addNode("openSanctionsNode", openSanctionsAgent);
workflow.addNode("ipIntelNode", ipIntelAgent);
workflow.addNode("exchangeRateNode", exchangeRateAgent);
workflow.addNode("adverseMediaNode", adverseMediaAgent);
workflow.addNode("mergeEnrichmentNode", mergeEnrichmentAgent);

workflow.addNode("qaNode", qualityAssuranceAgent);
workflow.addNode("investigationNode", investigationAgent);
workflow.addNode("decisionNode", decisionAgent);
workflow.addNode("saveNode", saveReportsAgent);

// Graph Execution Topology
workflow.addEdge(START, "loadTransactionsNode");

// Parallel Enrichment Fan-Out
workflow.addEdge("loadTransactionsNode", "openSanctionsNode");
workflow.addEdge("loadTransactionsNode", "ipIntelNode");
workflow.addEdge("loadTransactionsNode", "exchangeRateNode");
workflow.addEdge("loadTransactionsNode", "adverseMediaNode");

// Parallel Enrichment Fan-In (Merge)
workflow.addEdge("openSanctionsNode", "mergeEnrichmentNode");
workflow.addEdge("ipIntelNode", "mergeEnrichmentNode");
workflow.addEdge("exchangeRateNode", "mergeEnrichmentNode");
workflow.addEdge("adverseMediaNode", "mergeEnrichmentNode");

workflow.addEdge("mergeEnrichmentNode", "qaNode");

// Conditional Routing based on QA Risk Classification
workflow.addConditionalEdges("qaNode", qaRouter, {
    LOW: "decisionNode",
    MEDIUM: "investigationNode",
    HIGH: "investigationNode"
});

workflow.addEdge("investigationNode", "decisionNode");
workflow.addEdge("decisionNode", "saveNode");
workflow.addEdge("saveNode", END);

// Compile Graph
export const graph = workflow.compile();