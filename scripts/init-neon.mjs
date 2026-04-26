import fs from 'node:fs/promises';
import process from 'node:process';
import { neon } from '@neondatabase/serverless';

let url = process.env.DATABASE_URL || '';
if (!url) {
  url = await new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { s += chunk; });
    process.stdin.on('end', () => resolve(s.trim()));
  });
}

if (!url) throw new Error('DATABASE_URL required on stdin or env');

const sqlText = await fs.readFile(new URL('../neon.sql', import.meta.url), 'utf8');
const sql = neon(url);
for (const stmt of sqlText.split(';').map((s) => s.trim()).filter(Boolean)) {
  await sql.query(stmt);
}
console.log('Neon schema ready');
