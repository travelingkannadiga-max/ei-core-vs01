import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

/** PostgreSQL boundary. Never call external providers while a transaction is open. */
export class Database {
  constructor(public readonly pool: Pool) {}

  async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(sql, [...params]);
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const value = await fn(client);
      await client.query('COMMIT');
      began = false;
      return value;
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
