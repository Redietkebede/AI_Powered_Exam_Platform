import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

export const db = {
  query: (text: string, params?: any[]) => pool.query(text, params),
};

export async function pingDb() {
  const r = await pool.query(`
    select current_database() as db,
           current_user as db_user,
           inet_server_addr()::text as host,
           inet_server_port() as port
  `);
  return r.rows[0];
}

(async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Connected to DB at:', res.rows[0].now);
  } catch (err: any) {
    console.error('❌ Database connection failed:', err.message);
  }
})();

process.on("SIGINT", async () => { await pool.end(); process.exit(0); });

export default pool;