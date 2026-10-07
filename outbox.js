"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Outbox = void 0;
class Outbox {
    async add(c, aggregateId, eventType, payload) { await c.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES('Booking',$1,$2,$3)`, [aggregateId, eventType, payload]); }
}
exports.Outbox = Outbox;
