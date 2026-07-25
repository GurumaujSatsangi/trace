import { Annotation } from "@langchain/langgraph";

export const TransactionState = Annotation.Root({

    transaction: Annotation(),

    enrichedData: Annotation(),

    ruleResults: Annotation(),

    confidenceScore: Annotation(),

    riskLevel: Annotation(),

    flags: Annotation(),

    report: Annotation()

});