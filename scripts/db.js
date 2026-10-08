const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
function databaseConfig() {
    if (!process.env.DATABASE_URL && !process.env.PGHOST) throw new Error('Thi?u DATABASE_URL. ?i?n k?t n?i Neon v?o .env theo .env.example.');
    return { ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}), connectionTimeoutMillis: 15000, max: 5 };
}
function createClient() { return new Client(databaseConfig()); }
module.exports = { createClient, databaseConfig };
