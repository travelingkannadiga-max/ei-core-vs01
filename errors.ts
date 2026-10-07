export class DomainError extends Error { constructor(public readonly code:string, message:string, public readonly statusCode=400, public readonly retryable=false){super(message);this.name='DomainError';} }
export class PriceChangedError extends DomainError {constructor(){super('ERR_PRICE_CHANGED','Quote is expired or no longer authoritative',412,false)}}
export class IdempotencyConflictError extends DomainError {constructor(){super('ERR_IDEMPOTENCY_CONFLICT','Idempotency key conflicts with a different request',409,false)}}
export class NotFoundError extends DomainError {constructor(){super('ERR_NOT_FOUND','Resource not found',404,false)}}
export class ConcurrencyError extends DomainError {constructor(){super('ERR_CONCURRENCY_CONFLICT','Optimistic concurrency conflict',409,true)}}
export class InvalidStateError extends DomainError {constructor(message:string){super('ERR_INVALID_STATE',message,409,false)}}
