/**
 * Order Service - Mock implementation for CSR agent
 * Replace with real order service in production
 */

export interface Order {
  id: string;
  status: string;
  items: Array<{ name: string; quantity: number; price: number }>;
  total: number;
  shippingAddress: string;
  trackingNumber?: string;
  estimatedDelivery?: Date;
  createdAt: Date;
}

export class OrderService {
  private orders: Map<string, Order> = new Map();

  constructor() {
    // Seed with sample data
    this.orders.set('ORD-12345', {
      id: 'ORD-12345',
      status: 'shipped',
      items: [{ name: 'Product A', quantity: 2, price: 49.99 }],
      total: 99.99,
      shippingAddress: '123 Main St, City, State 12345',
      trackingNumber: 'TRACK123',
      estimatedDelivery: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    });
  }

  async findById(orderId: string): Promise<Order | null> {
    return this.orders.get(orderId) || null;
  }

  async updateAddress(orderId: string, newAddress: Record<string, unknown>): Promise<Order | null> {
    const order = this.orders.get(orderId);
    if (!order) return null;
    order.shippingAddress = String(newAddress?.address || newAddress);
    return order;
  }
}
