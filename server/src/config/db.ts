import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

(async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Connected to DB at:', res.rows[0].now);
  } catch (err: any) {
    console.error('❌ Database connection failed:', err.message);
  }
})();


export default pool;