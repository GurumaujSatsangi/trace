import duckdb from "duckdb";

const db = new duckdb.Database(":memory:");

const runDuckQuery = (sqlQuery) => new Promise((resolve, reject) => {
    db.all(sqlQuery, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

async function main() {
    console.log("Loading transactions...");
    await new Promise((res, rej) => db.run("CREATE OR REPLACE TEMP VIEW transactions AS SELECT * FROM read_csv_auto('c:/Users/gurum/OneDrive - vit.ac.in/Desktop/trace/data/transactions.csv', HEADER = TRUE)", (e) => e ? rej(e) : res()));
    
    console.log("Loading reports...");
    await new Promise((res, rej) => db.run("CREATE OR REPLACE TEMP VIEW compliance_reports AS SELECT * FROM read_json_auto('c:/Users/gurum/OneDrive - vit.ac.in/Desktop/trace/data/compliance_reports.json')", (e) => e ? rej(e) : res()));

    console.log("Running JOIN query...");
    const sql = `SELECT * FROM transactions t JOIN compliance_reports cr ON t.transaction_id = cr.transaction_id WHERE cr.risk_level ILIKE 'HIGH'`;
    try {
        const results = await runDuckQuery(sql);
        console.log("Results returned:", results.length);
        console.log("Result stringified size:", JSON.stringify(results).length);
    } catch(e) {
        console.error("DB ERROR", e);
    }
}
main();
