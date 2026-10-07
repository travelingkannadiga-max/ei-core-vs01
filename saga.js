"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Saga = void 0;
const node_crypto_1 = require("node:crypto");
const models_1 = require("../domain/models");
const state_machines_1 = require("../domain/state-machines");
const errors_1 = require("../domain/errors");
class Saga {
    db;
    supply;
    payment;
    outbox;
    audit;
    constructor(db, supply, payment, outbox, audit) {
        this.db = db;
        this.supply = supply;
        this.payment = payment;
        this.outbox = outbox;
        this.audit = audit;
    }
    async createBooking(i) {
        const currency = String(i.currency).trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency))
            throw new Error('Invalid currency');
        if (!i.idempotencyKey || i.idempotencyKey.length > 200)
            throw new Error('Invalid idempotency key');
        const quoteExpiry = new Date(i.quoteExpiresAt);
        if (!Number.isFinite(quoteExpiry.getTime()) || i.pricingSource !== 'EI-07_REVENUE' || quoteExpiry <= new Date())
            throw new errors_1.PriceChangedError();
        if (i.totalAmountMinor <= 0n || i.supplierCostMinor < 0n)
            throw new Error('Invalid money amount');
        if (!i.components.length || i.components.some(x => x.netCostMinor < 0n))
            throw new Error('Invalid component costs');
        const componentCost = i.components.reduce((sum, x) => sum + x.netCostMinor, 0n);
        if (componentCost !== i.supplierCostMinor)
            throw new Error('Component costs do not match authoritative supplier cost');
        const normalizedComponents = i.components.map(x => ({ type: x.type, supplierId: x.supplierId, quoteKey: x.quoteKey, netCostMinor: x.netCostMinor.toString() })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        const requestFingerprint = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({ tripId: i.tripId, proposalId: i.proposalId, quoteId: i.quoteId, quoteVersion: i.quoteVersion, quoteExpiresAt: quoteExpiry.toISOString(), totalAmountMinor: i.totalAmountMinor.toString(), currency, supplierCostMinor: i.supplierCostMinor.toString(), pricingSource: i.pricingSource, components: normalizedComponents })).digest('hex');
        return this.db.transaction(async (c) => {
            const existing = (await c.query(`SELECT id, quote_id, quote_version, total_amount_minor, currency, request_fingerprint FROM bookings WHERE idempotency_key=$1 FOR UPDATE`, [i.idempotencyKey])).rows[0];
            if (existing) {
                if (existing.request_fingerprint !== requestFingerprint)
                    throw new errors_1.IdempotencyConflictError();
                return existing.id;
            }
            const r = await c.query(`INSERT INTO bookings(trip_id,proposal_id,quote_id,quote_version,quote_expires_at,pricing_source,booking_status,payment_status,refund_status,total_amount_minor,currency,idempotency_key,request_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [i.tripId, i.proposalId, i.quoteId, i.quoteVersion, i.quoteExpiresAt, i.pricingSource, models_1.BookingStatus.PRICE_CONFIRMED, models_1.PaymentStatus.INITIATED, models_1.RefundStatus.NONE, i.totalAmountMinor.toString(), currency, i.idempotencyKey, requestFingerprint]);
            const id = r.rows[0].id;
            for (const x of i.components)
                await c.query(`INSERT INTO booking_components(booking_id,type,supplier_id,supplier_quote_key,net_cost_minor,currency,status) VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, x.type, x.supplierId, x.quoteKey, x.netCostMinor.toString(), currency, models_1.ComponentStatus.PENDING]);
            await this.audit.log(c, id, { actorType: 'SYSTEM', actorId: 'EI-CORE', executedBy: 'EI-CORE', action: 'BOOKING_CREATED', newState: models_1.BookingStatus.PRICE_CONFIRMED, reason: 'Authoritative EI-07 quote accepted', idempotencyKey: i.idempotencyKey });
            await this.outbox.add(c, id, 'BookingCreated', { bookingId: id, quoteId: i.quoteId });
            return id;
        });
    }
    async requestHolds(bookingId) {
        await this.db.transaction(async (c) => {
            const b = (await c.query(`SELECT booking_status FROM bookings WHERE id=$1 FOR UPDATE`, [bookingId])).rows[0];
            if (!b)
                throw new errors_1.NotFoundError();
            // The hold endpoint is idempotent at the booking level: a client retry
            // after the first request must not attempt a second state transition.
            if (b.booking_status === models_1.BookingStatus.INVENTORY_HELD || b.booking_status === models_1.BookingStatus.PAYMENT_PENDING || b.booking_status === models_1.BookingStatus.PAYMENT_REQUIRES_ACTION || b.booking_status === models_1.BookingStatus.PAYMENT_AUTHORIZED || b.booking_status === models_1.BookingStatus.PAYMENT_CAPTURED || b.booking_status === models_1.BookingStatus.BOOKING_PROCESSING || b.booking_status === models_1.BookingStatus.SUPPLIER_PENDING || b.booking_status === models_1.BookingStatus.CONFIRMED)
                return;
            if (b.booking_status !== models_1.BookingStatus.INVENTORY_LOCK_REQUESTED)
                (0, state_machines_1.assertBooking)(b.booking_status, models_1.BookingStatus.INVENTORY_LOCK_REQUESTED);
            await c.query(`UPDATE bookings SET booking_status=$1,version=version+1,updated_at=now() WHERE id=$2 AND booking_status=$3`, [models_1.BookingStatus.INVENTORY_LOCK_REQUESTED, bookingId, b.booking_status]);
            if ([models_1.BookingStatus.HOLD_FAILED, models_1.BookingStatus.HOLD_EXPIRED].includes(b.booking_status)) {
                await c.query(`UPDATE booking_components SET status='PENDING',supplier_hold_id=NULL,supplier_reference=NULL,compensation_status='NONE',updated_at=now() WHERE booking_id=$1 AND status IN ('HOLD_FAILED','CANCELLED','CANCEL_FAILED','CANCEL_UNKNOWN')`, [bookingId]);
                await c.query(`DELETE FROM supplier_operations WHERE booking_id=$1 AND operation_type='HOLD' AND status IN ('FAILED','UNKNOWN','EXHAUSTED')`, [bookingId]);
            }
            const xs = (await c.query(`SELECT * FROM booking_components WHERE booking_id=$1 AND status=$2`, [bookingId, models_1.ComponentStatus.PENDING])).rows;
            for (const x of xs) {
                const key = `hold:${x.id}`;
                await c.query(`UPDATE booking_components SET status=$1 WHERE id=$2`, [models_1.ComponentStatus.HOLD_REQUESTED, x.id]);
                await c.query(`INSERT INTO supplier_operations(booking_id,component_id,operation_type,operation_key,supplier_id,status) VALUES($1,$2,'HOLD',$3,$4,$5) ON CONFLICT(operation_key) DO NOTHING`, [bookingId, x.id, key, x.supplier_id, models_1.OperationStatus.REQUESTED]);
            }
        });
        await this.runHolds(bookingId);
    }
    async runHolds(bookingId) {
        const xs = (await this.db.query(`SELECT bc.*,so.operation_key FROM booking_components bc JOIN supplier_operations so ON so.component_id=bc.id WHERE bc.booking_id=$1 AND bc.status=$2 AND so.operation_type='HOLD' AND so.status IN ('REQUESTED','RUNNING')`, [bookingId, models_1.ComponentStatus.HOLD_REQUESTED])).rows;
        for (const x of xs) {
            await this.db.query(`UPDATE supplier_operations SET status='RUNNING',attempt=attempt+1,started_at=now(),updated_at=now() WHERE operation_key=$1`, [x.operation_key]);
            try {
                const h = await this.supply.holdInventory(x.type, x.supplier_quote_key, x.operation_key);
                await this.db.transaction(async (c) => { await c.query(`UPDATE booking_components SET status=$1,supplier_hold_id=$2,updated_at=now() WHERE id=$3`, [models_1.ComponentStatus.HELD, h.holdId, x.id]); await c.query(`UPDATE supplier_operations SET status='SUCCEEDED',supplier_reference=$1,completed_at=now(),updated_at=now() WHERE operation_key=$2`, [h.holdId, x.operation_key]); await this.audit.log(c, bookingId, { actorType: 'SYSTEM', actorId: 'EI-CORE', executedBy: 'EI-CORE', action: 'INVENTORY_HELD', newState: models_1.ComponentStatus.HELD }); });
            }
            catch (e) {
                await this.db.transaction(async (c) => { await c.query(`UPDATE booking_components SET status=$1,updated_at=now() WHERE id=$2`, [models_1.ComponentStatus.HOLD_FAILED, x.id]); await c.query(`UPDATE supplier_operations SET status='FAILED',last_error=$1,completed_at=now(),updated_at=now() WHERE operation_key=$2`, [String(e), x.operation_key]); });
            }
        }
        const states = (await this.db.query(`SELECT status FROM booking_components WHERE booking_id=$1`, [bookingId])).rows.map(x => x.status);
        if (states.length && states.every((s) => s === models_1.ComponentStatus.HELD)) {
            await this.db.transaction(async (c) => { const b = (await c.query(`SELECT booking_status FROM bookings WHERE id=$1 FOR UPDATE`, [bookingId])).rows[0]; if (b?.booking_status === models_1.BookingStatus.INVENTORY_LOCK_REQUESTED) {
                await c.query(`UPDATE bookings SET booking_status=$1,version=version+1,updated_at=now() WHERE id=$2`, [models_1.BookingStatus.INVENTORY_HELD, bookingId]);
                await this.outbox.add(c, bookingId, 'InventoryHeld', { bookingId });
            } });
        }
        else if (states.some((s) => s === models_1.ComponentStatus.HOLD_FAILED)) {
            await this.db.transaction(async (c) => { const b = (await c.query(`SELECT booking_status FROM bookings WHERE id=$1 FOR UPDATE`, [bookingId])).rows[0]; if (b && [models_1.BookingStatus.INVENTORY_LOCK_REQUESTED, models_1.BookingStatus.INVENTORY_HELD].includes(b.booking_status)) {
                await c.query(`UPDATE bookings SET booking_status=$1,version=version+1,updated_at=now() WHERE id=$2`, [models_1.BookingStatus.HOLD_FAILED, bookingId]);
                await this.outbox.add(c, bookingId, 'InventoryHoldFailed', { bookingId });
            } });
            // A partial hold is not a safe terminal state: release every sibling hold
            // already acquired so inventory is not stranded. Compensation is itself
            // idempotent at the supplier boundary and failures remain visible.
            await this.compensate(bookingId);
        }
    }
    async createPayment(bookingId, key) {
        // Claim the operation durably before contacting the provider. A concurrent
        // retry observes RUNNING and cannot create a second intent.
        const claim = await this.db.transaction(async (c) => {
            const b = (await c.query(`SELECT * FROM bookings WHERE id=$1 FOR UPDATE`, [bookingId])).rows[0];
            if (!b)
                throw new errors_1.NotFoundError();
            if (new Date(b.quote_expires_at) <= new Date())
                throw new errors_1.PriceChangedError();
            if (!key || key.length > 200)
                throw new Error('Invalid idempotency key');
            const opKey = `create-intent:${bookingId}`;
            const prior = (await c.query(`SELECT status,gateway_reference,last_error FROM payment_operations WHERE operation_key=$1 FOR UPDATE`, [opKey])).rows[0];
            if (prior?.status === 'SUCCEEDED') {
                if (!prior.gateway_reference)
                    throw new Error('Payment operation invariant violated: SUCCEEDED without gateway reference');
                const p = (await c.query(`SELECT gateway_reference,payment_status FROM payments WHERE booking_id=$1 AND gateway_reference=$2`, [bookingId, prior.gateway_reference])).rows[0];
                if (!p)
                    throw new Error('Payment operation invariant violated: persisted intent is missing; reconcile manually');
                return { kind: 'EXISTING', result: { gatewayReference: p.gateway_reference, status: p.payment_status } };
            }
            // Any pre-existing operation is never reclaimed blindly. RUNNING/UNKNOWN
            // may already have reached the provider; FAILED may be ambiguous too.
            // Reconciliation must resolve it before a new logical attempt is allowed.
            if (prior)
                return { kind: 'PENDING' };
            if (b.booking_status !== models_1.BookingStatus.INVENTORY_HELD)
                throw new Error('Booking is not ready for payment');
            await c.query(`INSERT INTO payment_operations(booking_id,operation_key,operation_type,status,attempt) VALUES($1,$2,'CREATE_INTENT','RUNNING',1)`, [bookingId, opKey]);
            return { kind: 'CLAIMED', opKey, amount: BigInt(b.total_amount_minor), currency: String(b.currency).trim().toUpperCase() };
        });
        if (claim.kind === 'EXISTING')
            return claim.result;
        if (claim.kind === 'PENDING')
            throw new Error('Payment intent creation is pending reconciliation; do not retry with a new key');
        try {
            const p = await this.payment.createPaymentIntent(claim.amount, claim.currency, claim.opKey);
            await this.db.transaction(async (c) => {
                await c.query(`INSERT INTO payments(booking_id,gateway_reference,provider,payment_status,amount_minor,currency) VALUES($1,$2,'MOCK',$3,$4,$5) ON CONFLICT(booking_id,gateway_reference) DO NOTHING`, [bookingId, p.gatewayReference, p.status, claim.amount.toString(), claim.currency]);
                await c.query(`UPDATE payment_operations SET status='SUCCEEDED',gateway_reference=$1,updated_at=now() WHERE operation_key=$2`, [p.gatewayReference, claim.opKey]);
                const target = models_1.BookingStatus.PAYMENT_PENDING;
                const current = (await c.query(`SELECT booking_status FROM bookings WHERE id=$1 FOR UPDATE`, [bookingId])).rows[0];
                (0, state_machines_1.assertBooking)(current.booking_status, target);
                await c.query(`UPDATE bookings SET payment_status=$1,booking_status=$2,version=version+1,updated_at=now() WHERE id=$3`, [p.status, target, bookingId]);
                await this.outbox.add(c, bookingId, 'PaymentInitiated', { bookingId, gatewayReference: p.gatewayReference });
            });
            return p;
        }
        catch (e) {
            // Provider outcome may be ambiguous. Never blindly issue a second intent.
            await this.db.query(`UPDATE payment_operations SET status='UNKNOWN',last_error=$1,updated_at=now() WHERE operation_key=$2`, [String(e), claim.opKey]);
            throw e;
        }
    }
    async handlePaymentWebhook(bookingId, raw, signature) {
        const event = await this.payment.verifyWebhook(raw, signature);
        let captured = false;
        await this.db.transaction(async (c) => {
            const b = (await c.query(`SELECT * FROM bookings WHERE id=$1 FOR UPDATE`, [bookingId])).rows[0];
            if (!b)
                throw new errors_1.NotFoundError();
            const p = (await c.query(`SELECT * FROM payments WHERE booking_id=$1 AND gateway_reference=$2 FOR UPDATE`, [bookingId, event.gatewayReference])).rows[0];
            if (!p)
                throw new errors_1.NotFoundError();
            if (BigInt(p.amount_minor) !== event.amount || String(p.currency).trim().toUpperCase() !== event.currency.trim().toUpperCase())
                throw new Error('Webhook amount/currency mismatch');
            const inserted = await c.query(`INSERT INTO payment_webhook_events(event_id,booking_id,gateway_reference) VALUES($1,$2,$3) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`, [event.eventId, bookingId, event.gatewayReference]);
            if (inserted.rowCount === 0)
                return;
            if (event.status === models_1.PaymentStatus.AUTHORIZED && p.payment_status !== models_1.PaymentStatus.AUTHORIZED) {
                (0, state_machines_1.assertPayment)(p.payment_status, models_1.PaymentStatus.AUTHORIZED);
                (0, state_machines_1.assertBooking)(b.booking_status, models_1.BookingStatus.PAYMENT_AUTHORIZED);
                await c.query(`UPDATE payments SET payment_status='AUTHORIZED',updated_at=now() WHERE id=$1`, [p.id]);
                await c.query(`UPDATE bookings SET payment_status='AUTHORIZED',booking_status='PAYMENT_AUTHORIZED',version=version+1,updated_at=now() WHERE id=$1`, [bookingId]);
                await this.outbox.add(c, bookingId, 'PaymentAuthorized', { bookingId });
            }
            else if (event.status === models_1.PaymentStatus.CAPTURED && p.payment_status !== models_1.PaymentStatus.CAPTURED) {
                (0, state_machines_1.assertPayment)(p.payment_status, models_1.PaymentStatus.CAPTURED);
                (0, state_machines_1.assertBooking)(b.booking_status, models_1.BookingStatus.BOOKING_PROCESSING);
                await c.query(`UPDATE payments SET payment_status='CAPTURED',updated_at=now() WHERE id=$1`, [p.id]);
                await c.query(`UPDATE bookings SET payment_status='CAPTURED',booking_status='BOOKING_PROCESSING',version=version+1,updated_at=now() WHERE id=$1`, [bookingId]);
                await this.outbox.add(c, bookingId, 'PaymentCaptured', { bookingId });
                captured = true;
            }
            else if (event.status === models_1.PaymentStatus.FAILED && p.payment_status !== models_1.PaymentStatus.FAILED) {
                if ([models_1.PaymentStatus.INITIATED, models_1.PaymentStatus.REQUIRES_ACTION, models_1.PaymentStatus.AUTHORIZED].includes(p.payment_status))
                    (0, state_machines_1.assertPayment)(p.payment_status, models_1.PaymentStatus.FAILED);
                await c.query(`UPDATE payments SET payment_status='FAILED',updated_at=now() WHERE id=$1`, [p.id]);
                await c.query(`UPDATE bookings SET payment_status='FAILED',booking_status='BOOKING_FAILED',version=version+1,updated_at=now() WHERE id=$1`, [bookingId]);
                await this.outbox.add(c, bookingId, 'PaymentFailed', { bookingId });
            }
        });
        if (captured)
            await this.commitComponents(bookingId);
    }
    async commitComponents(bookingId) {
        const xs = (await this.db.query(`SELECT * FROM booking_components WHERE booking_id=$1 AND status='HELD'`, [bookingId])).rows;
        for (const x of xs) {
            const key = `commit:${x.id}`;
            await this.db.transaction(async (c) => { await c.query(`UPDATE booking_components SET status='COMMIT_REQUESTED',updated_at=now() WHERE id=$1`, [x.id]); await c.query(`INSERT INTO supplier_operations(booking_id,component_id,operation_type,operation_key,supplier_id,status) VALUES($1,$2,'COMMIT',$3,$4,'REQUESTED') ON CONFLICT(operation_key) DO NOTHING`, [bookingId, x.id, key, x.supplier_id, models_1.OperationStatus.REQUESTED]); });
            try {
                const r = await this.supply.commitBooking(x.type, x.supplier_hold_id, key);
                await this.db.transaction(async (c) => { await c.query(`UPDATE booking_components SET status='COMMITTED',supplier_reference=$1,updated_at=now() WHERE id=$2`, [r.supplierReference, x.id]); await c.query(`UPDATE supplier_operations SET status='SUCCEEDED',supplier_reference=$1,completed_at=now(),updated_at=now() WHERE operation_key=$2`, [r.supplierReference, key]); });
            }
            catch (e) {
                await this.db.transaction(async (c) => { await c.query(`UPDATE booking_components SET status='COMMIT_UNKNOWN',updated_at=now() WHERE id=$1`, [x.id]); await c.query(`UPDATE supplier_operations SET status='UNKNOWN',attempt=attempt+1,last_error=$1,next_retry_at=now()+interval '2 seconds',updated_at=now() WHERE operation_key=$2`, [String(e), key]); });
                await this.db.transaction(async (c) => { await c.query(`UPDATE bookings SET booking_status='SUPPLIER_PENDING',version=version+1,updated_at=now() WHERE id=$1 AND booking_status='BOOKING_PROCESSING'`, [bookingId]); await this.outbox.add(c, bookingId, 'CommitUnknown', { bookingId, componentId: x.id }); });
                return;
            }
        }
        const left = (await this.db.query(`SELECT count(*)::int n FROM booking_components WHERE booking_id=$1 AND status<>'COMMITTED'`, [bookingId])).rows[0].n;
        if (left === 0)
            await this.db.transaction(async (c) => { await c.query(`UPDATE bookings SET booking_status='CONFIRMED',version=version+1,updated_at=now() WHERE id=$1`, [bookingId]); await this.outbox.add(c, bookingId, 'BookingConfirmed', { bookingId }); });
    }
    async compensate(bookingId) {
        const state = (await this.db.query(`SELECT booking_status,payment_status FROM bookings WHERE id=$1`, [bookingId])).rows[0];
        if (!state)
            throw new errors_1.NotFoundError();
        const xs = (await this.db.query(`SELECT * FROM booking_components WHERE booking_id=$1 AND status IN ('COMMITTED','HELD')`, [bookingId])).rows;
        await this.db.transaction(async (c) => {
            const b = (await c.query(`SELECT booking_status FROM bookings WHERE id=$1 FOR UPDATE`, [bookingId])).rows[0];
            if (!b)
                throw new errors_1.NotFoundError();
            if (b.booking_status !== 'COMPENSATION_PENDING') {
                await c.query(`UPDATE bookings SET booking_status='COMPENSATION_PENDING',version=version+1,updated_at=now() WHERE id=$1`, [bookingId]);
                await this.outbox.add(c, bookingId, 'CompensationStarted', { bookingId });
            }
        });
        let failures = 0;
        for (const x of xs) {
            const ref = x.supplier_reference ?? x.supplier_hold_id;
            if (!ref)
                continue;
            const key = `cancel:${x.id}`;
            const claimed = await this.db.transaction(async (c) => {
                const prior = (await c.query(`SELECT status FROM supplier_operations WHERE operation_key=$1 FOR UPDATE`, [key])).rows[0];
                if (prior?.status === 'SUCCEEDED')
                    return { claimed: false, unresolved: false };
                if (prior) {
                    return { claimed: false, unresolved: true };
                }
                await c.query(`UPDATE booking_components SET status='CANCEL_REQUESTED',compensation_status='PENDING',updated_at=now() WHERE id=$1 AND status IN ('COMMITTED','HELD')`, [x.id]);
                await c.query(`INSERT INTO supplier_operations(booking_id,component_id,operation_type,operation_key,supplier_id,status,attempt) VALUES($1,$2,'CANCEL',$3,$4,'RUNNING',1)`, [bookingId, x.id, key, x.supplier_id]);
                return { claimed: true, unresolved: false };
            });
            if (claimed.unresolved) {
                failures++;
                continue;
            }
            if (!claimed.claimed)
                continue;
            try {
                const r = await this.supply.cancelBooking(x.type, ref, key);
                if (r === 'CANCELLED') {
                    await this.db.transaction(async (c) => {
                        await c.query(`UPDATE booking_components SET status='CANCELLED',compensation_status='COMPLETED',updated_at=now() WHERE id=$1`, [x.id]);
                        await c.query(`UPDATE supplier_operations SET status='SUCCEEDED',supplier_reference=$1,completed_at=now(),updated_at=now() WHERE operation_key=$2`, [ref, key]);
                    });
                }
                else {
                    failures++;
                    await this.db.transaction(async (c) => {
                        await c.query(`UPDATE booking_components SET status='CANCEL_UNKNOWN',compensation_status='FAILED',updated_at=now() WHERE id=$1`, [x.id]);
                        await c.query(`UPDATE supplier_operations SET status='UNKNOWN',last_error='Cancellation outcome unknown',next_retry_at=now()+interval '2 seconds',updated_at=now() WHERE operation_key=$1`, [key]);
                    });
                }
            }
            catch (e) {
                failures++;
                await this.db.transaction(async (c) => {
                    await c.query(`UPDATE booking_components SET status='CANCEL_FAILED',compensation_status='FAILED',updated_at=now() WHERE id=$1`, [x.id]);
                    await c.query(`UPDATE supplier_operations SET status='UNKNOWN',last_error=$1,next_retry_at=now()+interval '2 seconds',updated_at=now() WHERE operation_key=$2`, [String(e), key]);
                });
            }
        }
        const paymentCaptured = state.payment_status === models_1.PaymentStatus.CAPTURED;
        const target = failures ? 'COMPENSATION_FAILED' : (paymentCaptured ? 'REFUND_PENDING' : 'BOOKING_FAILED');
        await this.db.transaction(async (c) => {
            await c.query(`UPDATE bookings SET booking_status=$1,version=version+1,updated_at=now() WHERE id=$2`, [target, bookingId]);
            await this.outbox.add(c, bookingId, failures ? 'CompensationFailed' : (paymentCaptured ? 'CompensationCompleted' : 'BookingCompensationCompleted'), { bookingId });
        });
    }
}
exports.Saga = Saga;
