declare var process: any;
declare var Buffer: any;
declare module 'express' { const express: any; export = express; export namespace express { type Request = any; } }
declare module 'pg' { export const Pool: any; export type Pool = any; export type PoolClient = any; export type QueryResult<T=any> = any; export type QueryResultRow = any; }
declare module 'uuid' { export const v4: any; }
declare module 'zod' { export const z: any; }
declare module 'jest' { const x:any; export = x; }
declare function describe(...args:any[]): any;
declare function test(...args:any[]): any;
declare function expect(...args:any[]): any;
