import { Database } from '../infrastructure/database';
import { SupplyAdapter } from '../infrastructure/adapters/contracts';
import { ComponentStatus, OperationStatus } from '../domain/models';

export class VerifyStateWorker {
  constructor(private db: Database, private supply: SupplyAdapter, private maxAttempts = 5) {}

  async runOnce(limit = 20) {
    for (let i = 0; i < limit; i++) {
      const x = await this.db.transaction(async c => {
        const r = await c.query(`SELECT so.*,bc.type,bc.supplier_hold_id,bc.supplier_reference,bc.status AS component_status FROM supplier_operations so JOIN booking_components bc ON bc.id=so.component_id WHERE so.status IN ('UNKNOWN','VERIFY_REQUESTED') AND (so.next_retry_at IS NULL OR so.next_retry_at<=now()) ORDER BY so.created_at LIMIT 1 FOR UPDATE OF so SKIP LOCKED`);
        const row = r.rows[0];
        if (!row) return null;
        await c.query(`UPDATE supplier_operations SET status='VERIFY_REQUESTED',attempt=attempt+1,updated_at=now() WHERE id=$1`, [row.id]);
        return row;
      });
      if (!x) break;
      try {
        if (x.operation_type === 'CANCEL') {
          await this.reconcileCancellation(x);
          continue;
        }
        const state = await this.supply.verifyState(x.type, x.supplier_hold_id, x.operation_key);
        if (state === 'COMMITTED') {
          await this.db.transaction(async c => {
            await c.query(`UPDATE booking_components SET status='COMMITTED',updated_at=now() WHERE id=$1`, [x.component_id]);
            await c.query(`UPDATE supplier_operations SET status='SUCCEEDED',completed_at=now(),updated_at=now() WHERE id=$1`, [x.id]);
            const left = (await c.query(`SELECT count(*)::int n FROM booking_components WHERE booking_id=$1 AND status<>'COMMITTED'`, [x.booking_id])).rows[0].n;
            if (left === 0) await c.query(`UPDATE bookings SET booking_status='CONFIRMED',version=version+1,updated_at=now() WHERE id=$1 AND booking_status='SUPPLIER_PENDING'`, [x.booking_id]);
          });
        } else if (state === 'NOT_COMMITTED') {
          await this.db.transaction(async c => {
            await c.query(`UPDATE booking_components SET status='NOT_COMMITTED',updated_at=now() WHERE id=$1`, [x.component_id]);
            await c.query(`UPDATE supplier_operations SET status='FAILED',completed_at=now(),updated_at=now() WHERE id=$1`, [x.id]);
            await c.query(`UPDATE bookings SET booking_status='ESCALATED_HITL',version=version+1,updated_at=now() WHERE id=$1 AND booking_status='SUPPLIER_PENDING'`, [x.booking_id]);
          });
        } else await this.retry(x.id, x.attempt + 1, 'Supplier state still unknown');
      } catch (e) { await this.retry(x.id, x.attempt + 1, String(e)); }
    }
  }

  private async reconcileCancellation(x: any) {
    const reference = x.supplier_reference ?? x.supplier_hold_id;
    if (!reference) throw new Error('Cancellation reconciliation lacks supplier reference');
    const state = await this.supply.verifyCancellation(x.type, reference, x.operation_key);
    if (state === 'UNKNOWN') { await this.retry(x.id, x.attempt + 1, 'Cancellation state still unknown'); return; }
    if (state === 'NOT_CANCELLED') {
      const result = await this.supply.cancelBooking(x.type, reference, x.operation_key);
      if (result !== 'CANCELLED') { await this.retry(x.id, x.attempt + 1, 'Supplier cancellation retry unresolved'); return; }
    }
    await this.db.transaction(async c => {
      await c.query(`UPDATE booking_components SET status='CANCELLED',compensation_status='COMPLETED',updated_at=now() WHERE id=$1`, [x.component_id]);
      await c.query(`UPDATE supplier_operations SET status='SUCCEEDED',completed_at=now(),last_error=NULL,next_retry_at=NULL,updated_at=now() WHERE id=$1`, [x.id]);
      const unresolved = (await c.query(`SELECT count(*)::int n FROM supplier_operations WHERE booking_id=$1 AND operation_type='CANCEL' AND status NOT IN ('SUCCEEDED')`, [x.booking_id])).rows[0].n;
      const remaining = (await c.query(`SELECT count(*)::int n FROM booking_components WHERE booking_id=$1 AND status IN ('HELD','COMMITTED','CANCEL_REQUESTED','CANCEL_UNKNOWN','CANCEL_FAILED')`, [x.booking_id])).rows[0].n;
      if (unresolved === 0 && remaining === 0) {
        const b = (await c.query(`SELECT payment_status FROM bookings WHERE id=$1 FOR UPDATE`, [x.booking_id])).rows[0];
        const next = b?.payment_status === 'CAPTURED' ? 'REFUND_PENDING' : 'BOOKING_FAILED';
        await c.query(`UPDATE bookings SET booking_status=$1,version=version+1,updated_at=now() WHERE id=$2 AND booking_status IN ('COMPENSATION_FAILED','COMPENSATION_PENDING','COMPENSATION_PARTIAL')`, [next, x.booking_id]);
      }
    });
  }

  private async retry(id: string, attempt: number, error: string) {
    const exhausted = attempt >= this.maxAttempts;
    await this.db.query(`UPDATE supplier_operations SET status=$1,next_retry_at=CASE WHEN $1='EXHAUSTED' THEN NULL ELSE now()+((LEAST($2,8)*2)||' seconds')::interval END,last_error=$3,updated_at=now() WHERE id=$4`, [exhausted ? 'EXHAUSTED' : 'UNKNOWN', attempt, error, id]);
    if (exhausted) {
      const row = (await this.db.query(`SELECT booking_id FROM supplier_operations WHERE id=$1`, [id])).rows[0];
      if (row) await this.db.query(`UPDATE bookings SET booking_status='ESCALATED_HITL',version=version+1,updated_at=now() WHERE id=$1 AND booking_status IN ('SUPPLIER_PENDING','COMPENSATION_FAILED','COMPENSATION_PENDING','COMPENSATION_PARTIAL')`, [row.booking_id]);
    }
  }
}
