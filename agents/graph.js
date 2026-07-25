import { StateGraph, START, END } from "@langchain/langgraph";

import { TransactionState } from "../state/transactionState.js";

import { enrichmentAgent } from "./enrichmentAgent.js";
import { qualityAssuranceAgent } from "./qualityAssuranceAgent.js";
import { investigationAgent } from "./investigationAgent.js";
import { decisionAgent } from "./decisionAgent.js";
import { saveReportsAgent } from "./saveReportsAgent.js";

const workflow = new StateGraph(TransactionState);

// Register Nodes
workflow.addNode("enrichment", enrichmentAgent);
workflow.addNode("qa", qualityAssuranceAgent);
workflow.addNode("investigation", investigationAgent);
workflow.addNode("decision", decisionAgent);
workflow.addNode("save", saveReportsAgent);

// Workflow
workflow.addEdge(START, "enrichment");
workflow.addEdge("enrichment", "qa");
workflow.addEdge("qa", "investigation");
workflow.addEdge("investigation", "decision");
workflow.addEdge("decision", "save");
workflow.addEdge("save", END);

// Compile
export const graph = workflow.compile();