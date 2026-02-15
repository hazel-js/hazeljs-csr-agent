/**
 * Refund Service - Mock implementation for CSR agent
 * Replace with real refund service in production
 */

export interface RefundResult {
  id: string;
  orderId: string;
  amount: number;
  reason: string;
  status: string;
}

export class RefundService {
  async process(data: { orderId: string; amount: number; reason: string }): Promise<RefundResult> {
    return {
      id: 'REF-' + Date.now(),
      orderId: data.orderId,
      amount: data.amount,
      reason: data.reason,
      status: 'pending',
    };
  }
}
