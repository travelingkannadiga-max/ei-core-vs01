"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockSupplyAdapter = void 0;
class MockSupplyAdapter {
    behavior;
    committed = new Map();
    holds = new Map();
    cancelled = new Set();
    constructor(behavior = {}) {
        this.behavior = behavior;
    }
    async holdInventory(type, quoteKey, key) { if (this.behavior[key] === 'UNAVAILABLE')
        throw new Error('inventory unavailable'); let h = this.holds.get(key); if (!h) {
        h = `HOLD-${key}`;
        this.holds.set(key, h);
    } return { holdId: h }; }
    async commitBooking(type, holdId, key) { if (this.behavior[key] === 'TIMEOUT' || this.behavior[key] === 'UNKNOWN')
        throw new Error('timeout'); const ref = `SUP-${holdId}`; this.committed.set(holdId, ref); return { supplierReference: ref }; }
    async verifyState(type, holdId, key) { if (this.committed.has(holdId))
        return 'COMMITTED'; if (this.behavior[key] === 'UNREACHABLE')
        return 'UNKNOWN'; return 'NOT_COMMITTED'; }
    async cancelBooking(type, reference, key) { if (this.behavior[key] === 'CANCEL_FAIL')
        return 'FAILED'; this.cancelled.add(reference); return 'CANCELLED'; }
    async verifyCancellation(type, reference, key) { if (this.behavior[key] === 'CANCEL_UNKNOWN')
        return 'UNKNOWN'; return this.cancelled.has(reference) ? 'CANCELLED' : 'NOT_CANCELLED'; }
}
exports.MockSupplyAdapter = MockSupplyAdapter;
