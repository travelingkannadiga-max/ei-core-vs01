"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const pg_1 = require("pg");
const database_1 = require("./database");
async function main() {
    const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
    const db = new database_1.Database(pool);
    try {
        const sql = node_fs_1.default.readFileSync(node_path_1.default.join(process.cwd(), 'migrations/0001_initial_schema.up.sql'), 'utf8');
        await db.query(sql);
        process.stdout.write('migration complete\\n');
    }
    finally {
        await db.close();
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
