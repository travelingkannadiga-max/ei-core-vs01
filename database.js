"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Database = void 0;
/** PostgreSQL boundary. Never call external providers while a transaction is open. */
class Database {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async query(sql, params = []) {
        return this.pool.query(sql, [...params]);
    }
    async transaction(fn) {
        const client = await this.pool.connect();
        let began = false;
        try {
            await client.query('BEGIN');
            began = true;
            const value = await fn(client);
            await client.query('COMMIT');
            began = false;
            return value;
        }
        catch (error) {
            if (began) {
                try {
                    await client.query('ROLLBACK');
                }
                catch { /* preserve original failure */ }
            }
            throw error;
        }
        finally {
            client.release();
        }
    }
    async close() {
        await this.pool.end();
    }
}
exports.Database = Database;
