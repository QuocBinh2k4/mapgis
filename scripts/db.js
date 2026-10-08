const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function createClient() {
    if (process.env.DATABASE_URL) return new Client({ connectionString: process.env.DATABASE_URL });
    if (process.env.PGHOST || process.env.PGDATABASE) return new Client();
    // Tương thích cấu hình dự án hiện tại; không sao chép mật khẩu sang tập tin khác.
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const block = source.match(/new Pool\(\{([\s\S]*?)\}\)/)?.[1];
    if (!block) throw new Error('Set DATABASE_URL or PGHOST/PGDATABASE to connect.');
    const config = {};
    for (const key of ['user', 'host', 'database', 'password']) {
        const value = block.match(new RegExp(`${key}:\\s*(['"])(.*?)\\1`))?.[2];
        if (value !== undefined) config[key] = value;
    }
    config.port = Number(block.match(/port:\s*(\d+)/)?.[1] || 5432);
    return new Client(config);
}
module.exports = { createClient };
