import {Database} from './database';
export class SseGateway {
  constructor(private db:Database){}
  async append(bookingId:string,eventType:string,payload:unknown){
    return this.db.transaction(async c=>{
      const booking=(await c.query(`SELECT id FROM bookings WHERE id=$1 FOR UPDATE`,[bookingId])).rows[0];
      if(!booking) throw new Error('Booking not found');
      let stream=(await c.query(`SELECT stream_id FROM sse_events WHERE booking_id=$1 ORDER BY stream_seq LIMIT 1`,[bookingId])).rows[0]?.stream_id;
      if(!stream){stream=bookingId;}
      const n=(await c.query(`SELECT COALESCE(MAX(stream_seq),0)+1 n FROM sse_events WHERE stream_id=$1`,[stream])).rows[0].n;
      await c.query(`INSERT INTO sse_events(stream_id,booking_id,stream_seq,event_type,payload) VALUES($1,$2,$3,$4,$5)`,[stream,bookingId,n,eventType,payload]);
      return {streamId:stream,seq:Number(n)};
    });
  }
  async replay(bookingId:string,lastId:number){return (await this.db.query(`SELECT id,stream_id,stream_seq,event_type,payload,created_at FROM sse_events WHERE booking_id=$1 AND stream_seq>$2 ORDER BY stream_seq`,[bookingId,lastId])).rows;}
}
