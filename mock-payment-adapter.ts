import {PaymentStatus} from '../../domain/models'; import {PaymentAdapter} from './contracts';
export class MockPaymentAdapter implements PaymentAdapter {
 private statuses=new Map<string,PaymentStatus>();
 async createPaymentIntent(amount:bigint,currency:string,key:string){const ref=`PAY-${key}`;this.statuses.set(ref,PaymentStatus.REQUIRES_ACTION);return {gatewayReference:ref,status:PaymentStatus.REQUIRES_ACTION}}
 async getPaymentStatus(ref:string){return this.statuses.get(ref)??PaymentStatus.FAILED}
 async verifyWebhook(raw:string,signature:string){const expected=process.env.MOCK_WEBHOOK_SIGNATURE;if(!expected||signature!==expected)throw new Error('Invalid mock webhook signature');const x=JSON.parse(raw) as {eventId:string;gatewayReference:string;status:PaymentStatus;amount:string|number;currency:string};if(!x.eventId||!x.gatewayReference||!x.currency||x.amount===undefined)throw new Error('Invalid mock webhook payload');this.statuses.set(x.gatewayReference,x.status);return {...x,amount:BigInt(x.amount)}}
 async createRefund(ref:string,_amount:bigint,key:string){const providerReference=`REF-${ref}-${key}`;return {providerReference,status:PaymentStatus.REFUND_PENDING}}
 async getRefundStatus(_ref:string){return PaymentStatus.REFUNDED}
}
