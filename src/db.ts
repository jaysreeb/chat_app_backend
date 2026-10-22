import { Pool } from 'pg';
const pool = new Pool({
  host: process.env.DB_HOST,
  user: 'postgres',
  password: 'postgres',
  database: 'chatapp',
  port: 5432,
})

export default pool;