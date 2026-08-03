const D=require("better-sqlite3"); const db=new D(".data/vouchers.db");
const r=db.prepare("SELECT status,updated_at,pdf_at,invoice_key,closed_at FROM purchase_orders WHERE id='flow-test'").get();
const stale = r.pdf_key===null ? "n/a" : (r.pdf_at < r.updated_at ? "STALE" : "fresh");
console.log(`  status=${r.status.padEnd(9)} invoice=${r.invoice_key?"yes":"no ".padEnd(3)} closed=${r.closed_at?"yes":"no "}  pdf=${r.pdf_at < r.updated_at ? "STALE (banner shows)" : "fresh (no banner)"}`);
