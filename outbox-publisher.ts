import {Database} from '../infrastructure/database';
export interface EventSink {publish(topic:string,key:string,payload:unknown):Promise<void>}
export class OutboxPublisher {
  constructor(private db:Database,private sink:EventSink){}
  async runOnce(limit=50){
    await this.db.query(`UPDATE outbox_events SET status='PENDING',next_attempt_at=now() WHERE status='PROCESSING' AND processing_at < now()-interval '5 minutes'`);
    const rows=await this.db.transaction(async c=>{
      const r=await c.query(`SELECT * FROM outbox_events WHERE status='PENDING' AND (next_attempt_at IS NULL OR next_attempt_at<=now()) ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,[limit]);
      for(const x of r.rows) await c.query(`UPDATE outbox_events SET status='PROCESSING',attempt=attempt+1,processing_at=now() WHERE id=$1`,[x.id]);
      return r.rows;
    });
    for(const x of rows){try{await this.sink.publish('ei.booking.events',String(x.aggregate_id),x.payload);await this.db.query(`UPDATE outbox_events SET status='PROCESSED',processed_at=now(),processing_at=NULL WHERE id=$1`,[x.id]);}catch(e){await this.db.query(`UPDATE outbox_events SET status='PENDING',processing_at=NULL,next_attempt_at=now()+((LEAST(attempt,8)*2)||' seconds')::interval WHERE id=$1`,[x.id]);}}
  }
}
