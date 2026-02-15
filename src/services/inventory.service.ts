/**
 * Inventory Service - Mock implementation for CSR agent
 * Replace with real inventory service in production
 */

export class InventoryService {
  private inventory: Map<string, { quantity: number; nextRestock: Date }> = new Map();

  constructor() {
    this.inventory.set('PROD-001', { quantity: 10, nextRestock: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    this.inventory.set('PROD-002', { quantity: 0, nextRestock: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) });
  }

  async check(productId: string): Promise<{ quantity: number; nextRestock: Date } | null> {
    return this.inventory.get(productId) || null;
  }
}
