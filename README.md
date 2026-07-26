# TRACE --- Transaction Risk Analysis and Compliance Engine

> **Agentic AML investigation for transaction monitoring, enrichment,
> risk assessment, and conversational compliance analysis.**

TRACE is a prototype that turns transaction data into an
interactive Anti-Money Laundering (AML) investigation workflow. Users
upload transaction CSVs, TRACE normalizes and persists them, runs an
enrichment and risk-analysis graph, stores compliance reports, and
exposes the resulting evidence through conversational and tabular
analysis.

The system combines deterministic AML rules, external
screening/enrichment, LangGraph orchestration, DuckDB analytics,
Supabase persistence, and LLM-assisted investigation. Its chat layer
resolves conversational context into structured intents, entities, and
filters, then selects the analytical tools required for the request.

**Repository:** <https://github.com/GurumaujSatsangi/trace>

------------------------------------------------------------------------

## Problem Statement

Financial institutions process large transaction volumes that must be
reviewed for money-laundering and financial-crime indicators. Analysts
may need to correlate transaction attributes, screening results,
behavioural signals, external intelligence, and historical activity.

TRACE explores an agentic workflow that can:

- ingest and normalize transaction datasets;
- screen transactions using deterministic AML indicators;
- enrich records with sanctions/PEP, IP, exchange-rate, and
  adverse-media information;
- assign risk scores and recommended actions;
- route elevated-risk transactions through AI-assisted investigation;
- let analysts interrogate the active dataset using natural language;
- retain conversational context for AML follow-ups;
- selectively invoke analytical tools instead of running one fixed
  pipeline for every chat request.

TRACE is a **decision-support prototype**. Its outputs are investigative
indicators, not final legal or regulatory determinations.

------------------------------------------------------------------------

## Key Features

- CSV transaction upload and normalization
- LangGraph AML workflow with parallel enrichment and conditional
  routing
- OpenSanctions sanctions/PEP screening
- IP VPN/proxy intelligence
- NewsAPI adverse-media screening with GDELT fallback
- Exchange-rate enrichment
- Deterministic AML risk rules and LOW/MEDIUM/HIGH scoring
- AI-assisted investigation for elevated-risk transactions
- Compliance-report persistence in Supabase
- Context-aware AML chat
- Intent, entity, and filter extraction
- Query-aware tool planning
- DuckDB analytical querying
- Dataset-relative date handling for requests such as "last 30 days"
- Near-threshold activity analysis grouped by account/customer
- Validated read-only Text-to-SQL fallback
- Schema-aware tabular analytics
- Transaction/compliance drill-down

------------------------------------------------------------------------

## Why TRACE Is Agentic

TRACE does not treat every natural-language request as the same task.

``` text
User message + recent conversation
              │
              ▼
       Context Resolver
              │
       intent/entities/filters
              ▼
        Query Planner
              │
      ┌───────┼──────────────────┐
      ▼       ▼                  ▼
 Direct   Specialized       Controlled
 lookup   AML handlers      SQL fallback
      │       │                  │
      └───────┼──────────────────┘
              ▼
       Current evidence
              │
              ▼
       Response Formatter
```

A greeting does not invoke DuckDB. A transaction-risk question can
trigger transaction and compliance lookup. A structuring request can
invoke dataset-relative date resolution and the near-threshold activity
detector. Broader supported dataset questions can use validated
read-only SQL.

Conversation history is used to understand **what the user means**, not
as proof of AML facts. Current data is queried again before factual
findings are returned.

------------------------------------------------------------------------

## AML Analysis Graph

CSV upload invokes the LangGraph workflow:

``` mermaid
flowchart TD
    A[CSV Upload] --> B[Load Transactions]
    B --> C[OpenSanctions]
    B --> D[IP Intelligence]
    B --> E[Exchange Rate]
    B --> F[Adverse Media]
    C --> G[Merge Enrichment]
    D --> G
    E --> G
    F --> G
    G --> H[Deterministic AML / QA]
    H -->|LOW| J[Decision]
    H -->|MEDIUM / HIGH| I[AI Investigation]
    I --> J
    J --> K[Save Compliance Reports]
```

The enrichment stage fans out to sanctions/PEP screening, IP
intelligence, exchange-rate lookup, and adverse-media screening. QA then
applies deterministic rules and scores risk. LOW-risk transactions route
directly to decisioning; MEDIUM/HIGH transactions pass through the
investigation agent first.

------------------------------------------------------------------------

## Risk & Compliance Methodology

Current deterministic indicators include:

| Indicator                             | Current implementation                                                                             |
|:--------------------------------------|:---------------------------------------------------------------------------------------------------|
| Near-threshold / possible structuring | Amount `>= 9000` and `< 10000` with cash/deposit transaction type                                  |
| Sanctions                             | Positive current OpenSanctions screening result                                                    |
| PEP                                   | PEP evidence from current OpenSanctions screening                                                  |
| VPN / Proxy                           | IP-intelligence result                                                                             |
| High-risk jurisdiction                | Configured country list in `services/amlRules.js`                                                  |
| Adverse media                         | Current adverse-media enrichment                                                                   |
| Possible layering                     | Transfer/wire/SWIFT/corporate activity with differing destination country and non-self beneficiary |
| Behavioural anomaly                   | VPN/proxy combined with online/internet/mobile channel                                             |
| Large transaction                     | Normalized USD amount above the current configured rule threshold                                  |

Risk score is capped at 100:

``` text
LOW     < 40
MEDIUM  40–69
HIGH    >= 70
```

The decision stage can recommend Monitor, Manual Review, Enhanced Due
Diligence, Generate SAR, or Freeze Transaction according to the current
decision rules.

> \[!NOTE\] **Structuring limitation:** the current `9000–9999`
> cash/deposit rule is a single-transaction near-threshold indicator. It
> is not proof of a multi-transaction structuring scheme. Grouped
> results are candidates for investigation and require human review.

------------------------------------------------------------------------

## Technology Stack

| Layer               | Technology            | Purpose                                                       |
|:--------------------|:----------------------|:--------------------------------------------------------------|
| Runtime             | Node.js               | Application runtime                                           |
| Server              | Express 5             | HTTP/API server                                               |
| UI                  | EJS                   | Server-rendered frontend                                      |
| Agent orchestration | LangGraph             | AML workflow graph                                            |
| LLM integration     | LangChain + OpenAI    | Context resolution, investigation, responses, and Text-to-SQL |
| Analytics           | DuckDB                | In-memory querying of active data                             |
| Persistence         | Supabase / PostgreSQL | Transactions and compliance reports                           |
| Upload              | Multer                | CSV upload handling                                           |
| CSV parsing         | csv-parser            | Transaction parsing                                           |
| Integrations        | Axios                 | External enrichment APIs                                      |
| Reports             | PDFKit                | PDF/report support                                            |
| Configuration       | dotenv                | Environment variables                                         |

## Repository Structure

``` text
trace/
├── agents/
│   ├── graph.js
│   ├── enrichmentAgent.js
│   ├── qualityAssuranceAgent.js
│   ├── investigationAgent.js
│   ├── decisionAgent.js
│   └── saveReportsAgent.js
├── services/
│   ├── amlRules.js
│   ├── complianceReports.js
│   ├── contextResolver.js
│   ├── queryPlanner.js
│   ├── dateResolver.js
│   ├── structuringDetector.js
│   ├── responseFormatter.js
│   ├── openSanctions.js
│   ├── ipIntel.js
│   ├── newsScreening.js
│   ├── exchangeRates.js
│   └── retryPolicy.js
├── state/
│   └── transactionState.js
├── views/
│   └── home.ejs
├── data/
├── index.js
├── package.json
├── package-lock.json
└── .gitignore
```

------------------------------------------------------------------------

# Local Setup --- From Scratch

### Prerequisites

Install:

- Git
- Node.js and npm
- an OpenAI API key
- access to the provided TRACE Supabase configuration
- internet access for external enrichment

The repository currently does not pin Node through a package `engines`
field. Use a current Node.js LTS release compatible with the committed
dependencies.

### 1. Clone the repository

``` bash
git clone https://github.com/GurumaujSatsangi/trace.git
cd trace
```

### 2. Install dependencies

A lockfile is committed, so for a fresh clone use:

``` bash
npm ci
```

### 3. Configure environment variables

Create `.env` in the project root:

``` env
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_key

OPENAI_API_KEY=your_openai_api_key
API_KEY=your_openai_api_key

OPENSANCTIONS_API_KEY=your_opensanctions_api_key
NEWS_API=your_newsapi_key

PORT=3000
DEBUG=false
```

| Variable                |        Required?         | Purpose                                  |
|:------------------------|:------------------------:|:-----------------------------------------|
| `SUPABASE_URL`          |           Yes            | Supabase project URL                     |
| `SUPABASE_KEY`          |           Yes            | Server-side Supabase access              |
| `OPENAI_API_KEY`        |           Yes            | Main chat/context/query OpenAI client    |
| `API_KEY`               | Yes for AI investigation | OpenAI key used by investigation agents  |
| `OPENSANCTIONS_API_KEY` |       Recommended        | Authenticated OpenSanctions screening    |
| `NEWS_API`              |         Optional         | NewsAPI screening; GDELT is the fallback |
| `PORT`                  |         Optional         | Express port; defaults to `3000`         |
| `DEBUG`                 |         Optional         | Extra AML logging when set to `true`     |

**Current code note:** TRACE currently reads both `OPENAI_API_KEY` and
`API_KEY` for different OpenAI clients. For local setup, set both to the
same valid OpenAI key unless intentionally using separate credentials.

Never commit `.env`.

------------------------------------------------------------------------

### 4. Configure Supabase

TRACE uses Supabase as its hosted persistence layer for transaction data and compliance reports.

**No local PostgreSQL installation, local Supabase instance, database migration, or manual table creation is required when using the provided Supabase configuration.**

Add the provided Supabase credentials to `.env`:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_key
```

TRACE then connects directly to the configured Supabase project and uses the existing backend required by the application.

> [!IMPORTANT]
> Do not commit real Supabase credentials to Git. Keep them in `.env` and distribute demo credentials through the approved secret-sharing/submission mechanism.

### 5. Start TRACE

``` bash
npm start
```

This executes:

``` bash
node index.js
```

Default URL:

``` text
http://localhost:3000
```

------------------------------------------------------------------------

------------------------------------------------------------------------

## Input CSV Format

Every accepted row requires:

``` text
transaction_id
```

or:

``` text
Transaction_ID
```

Rows without a transaction ID are ignored.

The normalizer accepts canonical lower-case names and corresponding
variants used by the code, including:

``` text
account_id / Account_ID
customer_name / Customer_Name
amount / Amount
currency / Currency
transaction_type / Transaction_Type
timestamp / Timestamp
```

It also supports location, sender/beneficiary data, banks, IP/device
data, source/destination countries, payment method, merchant, channel,
exchange rate, USD amount, analysis status, and upload timestamp.

Defaults include:

- invalid/missing `amount` → `0`
- missing `currency` → `USD`
- missing `timestamp` → ingestion time
- missing `analysis_status` → `UPLOADED`
- missing `uploaded_at` → ingestion time
- missing/unparseable optional numeric values → `null`

### Synthetic example

``` csv
transaction_id,account_id,customer_name,amount,currency,transaction_type,timestamp,country,destination_country,channel,ip_address
TXN1001,ACC1001,Alex Morgan,2500,USD,Card Payment,2026-01-05T10:30:00Z,United States,United States,Online,198.51.100.10
TXN1002,ACC1002,Jordan Lee,9500,USD,Cash Deposit,2026-01-06T11:45:00Z,United States,United States,Branch,
TXN1003,ACC1002,Jordan Lee,4200,USD,Wire Transfer,2026-01-08T09:10:00Z,United States,Singapore,Online,203.0.113.20
```

All names and values above are fictional.

------------------------------------------------------------------------

------------------------------------------------------------------------

## How to Use TRACE

1.  Start TRACE and open the browser UI.
2.  Upload a transaction CSV.
3.  TRACE normalizes and upserts the transactions into Supabase.
4.  The LangGraph AML workflow performs enrichment and risk analysis.
5.  Compliance reports are persisted.
6.  Review the data/risk output in the UI and Tabular View.
7.  Ask AML questions through chat.
8.  Use follow-up questions without repeating all prior context.

Example questions:

``` text
Is TXN1002 high risk?
Why?
What action should we take?
Show all transactions for account ACC1002.
Show high-risk transactions.
Find structuring activity in the last 30 days.
Only show high-risk ones.
What about the previous 7 days?
Analyse this dataset for suspicious activity.
```

TRACE is intentionally AML-focused. Unrelated coding, creative-writing,
or general-knowledge prompts are routed out of scope rather than
answered as a general-purpose assistant.

------------------------------------------------------------------------

## Conversational Context

The context resolver extracts:

- intent;
- transaction/account/customer entities;
- risk filters;
- date expressions;
- AML-pattern filters;
- inherited-context state;
- clarification requirements.

Explicit information in a new message overrides inherited context.

``` text
User: Is TXN1002 high risk?
User: Why?
```

The second turn can inherit `TXN1002`, but TRACE re-reads current data
before making AML claims.

For relative expressions such as `last 30 days`, `previous 7 days`, and
`past 14 days`, the date resolver anchors analysis to the **maximum
valid timestamp in the active dataset**, rather than blindly using
today's date.

------------------------------------------------------------------------

------------------------------------------------------------------------

## External Enrichment

### OpenSanctions

Customer names are screened through OpenSanctions. Sanctions/PEP
findings used by AML rules come from current screening evidence rather
than LLM world knowledge.

### IP intelligence

TRACE queries `proxycheck.io` for VPN/proxy and IP-location signals.

### Adverse media

If `NEWS_API` is configured, TRACE uses NewsAPI. If unavailable,
invalid, rate-limited, or not configured, it attempts the public GDELT
news API.

### Exchange rates

TRACE queries the open Exchange Rate API to normalize transaction
amounts toward USD. Current fallback behaviour returns a neutral rate
when lookup fails.

------------------------------------------------------------------------

------------------------------------------------------------------------

## API Reference

| Method | Endpoint                        | Purpose                                     |
|:------:|:--------------------------------|:--------------------------------------------|
| `GET`  | `/`                             | Render TRACE UI                             |
| `POST` | `/api/upload`                   | Upload, normalize, persist, and analyse CSV |
| `GET`  | `/api/reports`                  | Fetch compliance reports                    |
| `GET`  | `/api/transactions/:account_id` | Fetch transactions for an account           |
| `POST` | `/api/chat`                     | Context-aware AML analysis                  |
| `GET`  | `/api/analytics/summary`        | Active-dataset analytical summary           |
| `GET`  | `/api/transaction/:id`          | Joined transaction/compliance detail        |

Upload uses multipart field:

``` text
csvFile
```

Example:

``` bash
curl -X POST -F "csvFile=@transactions.csv" http://localhost:3000/api/upload
```

Chat request:

``` json
{
  "message": "Is TXN1002 high risk?",
  "history": []
}
```

History items use:

``` json
{"role":"user","content":"..."}
```

or:

``` json
{"role":"assistant","content":"..."}
```

The server bounds history size before context resolution.

------------------------------------------------------------------------

## DuckDB & Tabular Analytics

TRACE uses an in-memory DuckDB database for analytical chat queries. It
creates temporary views over the active CSV and the current
compliance-report snapshot.

The schema-aware analytics endpoint can provide, when the required
fields/data exist:

- total transactions;
- total amount;
- unique accounts;
- risk distribution;
- high-risk count;
- transactions over time;
- transaction-type distribution.

Generated SQL in the fallback analytical path is validated as read-only
before execution.

------------------------------------------------------------------------

## Data Flow

``` mermaid
flowchart LR
    A[CSV] --> B[Normalize]
    B --> C[Supabase Transactions]
    C --> D[LangGraph AML Workflow]
    D --> E[Compliance Reports]
    E --> F[Supabase Reports]
    A --> G[Active CSV]
    F --> H[Report Snapshot]
    G --> I[DuckDB]
    H --> I
    J[Chat] --> K[Context Resolver]
    K --> L[Query Planner]
    L --> I
    I --> M[Grounded Response]
```

------------------------------------------------------------------------

------------------------------------------------------------------------

## Data & Security

- `.env` and credentials must never be committed.
- Uploaded transaction data is persisted to the configured Supabase
  project.
- The active uploaded CSV is also stored locally under `data/` by the
  prototype.
- Compliance reports are read from Supabase and serialized locally for
  DuckDB analytics.
- The application currently uses permissive CORS.
- TRACE does not currently implement production banking authentication,
  authorization, tenant isolation, audit controls, or deployment
  hardening.
- Do not use real customer/banking data in an unsecured development
  deployment.

------------------------------------------------------------------------

------------------------------------------------------------------------

## Troubleshooting

### "Please upload a transaction CSV file first"

Upload a valid CSV before asking dataset-dependent analytical questions.

### No valid transaction rows

Ensure the CSV contains `transaction_id` or `Transaction_ID`.

### Supabase errors

Check `SUPABASE_URL`, `SUPABASE_KEY`, the two expected tables, and the
`transaction_id` conflict constraint.

### OpenAI authentication/rate-limit errors

Verify both `OPENAI_API_KEY` and `API_KEY`.

### OpenSanctions unavailable

Configure `OPENSANCTIONS_API_KEY`. Failed screening is handled as
unavailable evidence, not a positive match.

### NewsAPI unavailable

`NEWS_API` is optional; TRACE attempts GDELT fallback.

### Port already in use

Set, for example:

``` env
PORT=3001
```

### DuckDB/native dependency installation issue

Use a supported Node.js LTS environment and reinstall from the lockfile:

``` bash
rm -rf node_modules
npm ci
```

Use the platform-equivalent removal command on Windows.

------------------------------------------------------------------------

------------------------------------------------------------------------

## Current Limitations

- Not production banking infrastructure.
- Near-threshold structuring logic is an indicator, not proof of a
  structuring scheme.
- AML heuristics require institutional/jurisdictional validation before
  real-world use.
- External screening depends on third-party service availability and
  data quality.
- OpenAI credentials currently use two environment-variable names.
- No production authentication/authorization layer.
- Runtime transaction/report data is written locally for the current
  workflow.
- `npm test` is currently a placeholder rather than an automated test
  suite.

------------------------------------------------------------------------


------------------------------------------------------------------------

## Disclaimer

**TRACE is a prototype AML decision-support system.** Risk scores,
flags, pattern indicators, generated investigations, and recommended
actions require appropriate human review. TRACE output must not be
treated as a final legal, regulatory, sanctions, PEP, fraud, or
compliance determination without authoritative data sources and the
controls required by the applicable institution and jurisdiction.
