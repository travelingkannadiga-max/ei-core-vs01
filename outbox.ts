import {PoolClient} from 'pg';
export class Outbox {async add(c:PoolClient,aggregateId:string,eventType:string,payload:unknown){await c.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES('Booking',$1,$2,$3)`,[aggregateId,eventType,payload])}}
