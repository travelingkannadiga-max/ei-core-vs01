import {BookingStatus,PaymentStatus,RefundStatus} from '../../src/domain/models';
import {assertBooking,assertPayment,assertRefund} from '../../src/domain/state-machines';
test('booking allows price confirmed to inventory lock request',()=>expect(()=>assertBooking(BookingStatus.PRICE_CONFIRMED,BookingStatus.INVENTORY_LOCK_REQUESTED)).not.toThrow());
test('payment allows requires action to captured',()=>expect(()=>assertPayment(PaymentStatus.REQUIRES_ACTION,PaymentStatus.CAPTURED)).not.toThrow());
test('refund allows pending to refunded',()=>expect(()=>assertRefund(RefundStatus.PENDING,RefundStatus.REFUNDED)).not.toThrow());
test('confirmed booking cannot return to processing',()=>expect(()=>assertBooking(BookingStatus.CONFIRMED,BookingStatus.BOOKING_PROCESSING)).toThrow());

test('inventory held enters payment pending before provider action',()=>expect(()=>assertBooking(BookingStatus.INVENTORY_HELD,BookingStatus.PAYMENT_PENDING)).not.toThrow());
test('payment pending can enter processing after capture',()=>expect(()=>assertBooking(BookingStatus.PAYMENT_PENDING,BookingStatus.BOOKING_PROCESSING)).not.toThrow());
test('payment pending can become authorized',()=>expect(()=>assertBooking(BookingStatus.PAYMENT_PENDING,BookingStatus.PAYMENT_AUTHORIZED)).not.toThrow());
test('authorized payment can enter processing after capture',()=>expect(()=>assertBooking(BookingStatus.PAYMENT_AUTHORIZED,BookingStatus.BOOKING_PROCESSING)).not.toThrow());
test('payment requires action can be authorized',()=>expect(()=>assertPayment(PaymentStatus.REQUIRES_ACTION,PaymentStatus.AUTHORIZED)).not.toThrow());
