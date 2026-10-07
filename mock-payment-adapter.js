"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockPaymentAdapter = void 0;
const models_1 = require("../../domain/models");
class MockPaymentAdapter {
    statuses = new Map();
    async createPaymentIntent(amount, currency, key) { const ref = `PAY-${key}`; this.statuses.set(ref, models_1.PaymentStatus.REQUIRES_ACTION); return { gatewayReference: ref, status: models_1.PaymentStatus.REQUIRES_ACTION }; }
    async getPaymentStatus(ref) { return this.statuses.get(ref) ?? models_1.PaymentStatus.FAILED; }
    async verifyWebhook(raw, signature) { const expected = process.env.MOCK_WEBHOOK_SIGNATURE; if (!expected || signature !== expected)
        throw new Error('Invalid mock webhook signature'); const x = JSON.parse(raw); if (!x.eventId || !x.gatewayReference || !x.currency || x.amount === undefined)
        throw new Error('Invalid mock webhook payload'); this.statuses.set(x.gatewayReference, x.status); return { ...x, amount: BigInt(x.amount) }; }
    async createRefund(ref, _amount, key) { const providerReference = `REF-${ref}-${key}`; return { providerReference, status: models_1.PaymentStatus.REFUND_PENDING }; }
    async getRefundStatus(_ref) { return models_1.PaymentStatus.REFUNDED; }
}
exports.MockPaymentAdapter = MockPaymentAdapter;
