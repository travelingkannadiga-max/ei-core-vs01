import {ComponentType} from '../../domain/models'; import {SupplyAdapter} from './contracts';
export class MockSupplyAdapter implements SupplyAdapter {
 private committed=new Map<string,string>(); private holds=new Map<string,string>(); private cancelled=new Set<string>();
 constructor(private behavior:Record<string,string>={}){}
 async holdInventory(type:ComponentType,quoteKey:string,key:string){if(this.behavior[key]==='UNAVAILABLE')throw new Error('inventory unavailable');let h=this.holds.get(key);if(!h){h=`HOLD-${key}`;this.holds.set(key,h)}return {holdId:h}}
 async commitBooking(type:ComponentType,holdId:string,key:string){if(this.behavior[key]==='TIMEOUT'||this.behavior[key]==='UNKNOWN')throw new Error('timeout');const ref=`SUP-${holdId}`;this.committed.set(holdId,ref);return {supplierReference:ref}}
 async verifyState(type:ComponentType,holdId:string,key:string){if(this.committed.has(holdId))return 'COMMITTED' as const;if(this.behavior[key]==='UNREACHABLE')return 'UNKNOWN' as const;return 'NOT_COMMITTED' as const}
 async cancelBooking(type:ComponentType,reference:string,key:string){if(this.behavior[key]==='CANCEL_FAIL')return 'FAILED' as const;this.cancelled.add(reference);return 'CANCELLED' as const}
 async verifyCancellation(type:ComponentType,reference:string,key:string){if(this.behavior[key]==='CANCEL_UNKNOWN')return 'UNKNOWN' as const;return this.cancelled.has(reference)?'CANCELLED' as const:'NOT_CANCELLED' as const}
}
