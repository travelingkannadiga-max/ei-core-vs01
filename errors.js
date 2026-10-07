"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidStateError = exports.ConcurrencyError = exports.NotFoundError = exports.IdempotencyConflictError = exports.PriceChangedError = exports.DomainError = void 0;
class DomainError extends Error {
    code;
    statusCode;
    retryable;
    constructor(code, message, statusCode = 400, retryable = false) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.retryable = retryable;
        this.name = 'DomainError';
    }
}
exports.DomainError = DomainError;
class PriceChangedError extends DomainError {
    constructor() { super('ERR_PRICE_CHANGED', 'Quote is expired or no longer authoritative', 412, false); }
}
exports.PriceChangedError = PriceChangedError;
class IdempotencyConflictError extends DomainError {
    constructor() { super('ERR_IDEMPOTENCY_CONFLICT', 'Idempotency key conflicts with a different request', 409, false); }
}
exports.IdempotencyConflictError = IdempotencyConflictError;
class NotFoundError extends DomainError {
    constructor() { super('ERR_NOT_FOUND', 'Resource not found', 404, false); }
}
exports.NotFoundError = NotFoundError;
class ConcurrencyError extends DomainError {
    constructor() { super('ERR_CONCURRENCY_CONFLICT', 'Optimistic concurrency conflict', 409, true); }
}
exports.ConcurrencyError = ConcurrencyError;
class InvalidStateError extends DomainError {
    constructor(message) { super('ERR_INVALID_STATE', message, 409, false); }
}
exports.InvalidStateError = InvalidStateError;
