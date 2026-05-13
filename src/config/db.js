import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
    host:               process.env.DB_HOST,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASSWORD,
    database:           process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit:    10,
    timezone:           "+06:00", 
});

export async function connectDB(){
    try {
    const conn = await pool.getConnection();
    console.log(" MySQL connected successfully");
    conn.release(); 
    } catch (err) {
    console.error(" MySQL connection failed:", err.message);
    process.exit(1); 
    }
}

export default pool;