import duckdb from "duckdb";

// Initialize an in-memory DuckDB database
const db = new duckdb.Database(':memory:');

db.all(`
  SELECT customer_name, COUNT(*) as tx_count, SUM(amount) as total_amount
  FROM 'data/transactions.csv'
  GROUP BY customer_name
`, (err, rows) => {
  if (err) {
    console.error("DuckDB Query Error:", err);
  } else {
    console.log("DuckDB Test Result:", rows);
  }
});