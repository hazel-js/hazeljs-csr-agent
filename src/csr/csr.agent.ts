/**
 * CSR Agent - AI-powered Customer Service Representative
 * Uses @Agent and @Tool decorators with memory, RAG, and approval workflows
 */

import { Agent, Tool } from '@hazeljs/agent';
import type { RAGService } from '@hazeljs/rag';
import { OrderService } from '../services/order.service';
import { InventoryService } from '../services/inventory.service';
import { RefundService } from '../services/refund.service';
import { TicketService } from '../services/ticket.service';
import type { QueueService } from '@hazeljs/queue';

const CSR_SYSTEM_PROMPT = `You are a helpful customer support agent for an e-commerce platform.
You can look up orders, check inventory, process refunds, create support tickets, and search the knowledge base.
Always be polite and professional. If you need to process a refund, explain why and what the customer can expect.
When searching the knowledge base, use the results to provide accurate, cited answers.
If you don't know something, say so and offer to create a support ticket for escalation.`;

@Agent({
  name: 'csr-agent',
  description: 'AI-powered customer support agent',
  systemPrompt: CSR_SYSTEM_PROMPT,
  enableMemory: true,
  enableRAG: true,
  ragTopK: 5,
  maxSteps: 15,
  temperature: 0.7,
})
export class CSRAgent {
  constructor(
    private orderService: OrderService,
    private inventoryService: InventoryService,
    private refundService: RefundService,
    private ticketService: TicketService,
    private ragService: RAGService,
    private queueService?: QueueService
  ) {}

  @Tool({
    description: 'Look up order information by order ID',
    parameters: [
      {
        name: 'orderId',
        type: 'string',
        description: 'The order ID to lookup (format: ORD-XXXXX)',
        required: true,
      },
    ],
  })
  async lookupOrder(input: { orderId: string }) {
    const order = await this.orderService.findById(input.orderId);

    if (!order) {
      return {
        found: false,
        message: `Order ${input.orderId} not found`,
      };
    }

    return {
      found: true,
      orderId: order.id,
      status: order.status,
      items: order.items,
      total: order.total,
      shippingAddress: order.shippingAddress,
      trackingNumber: order.trackingNumber,
      estimatedDelivery: order.estimatedDelivery,
    };
  }

  @Tool({
    description: 'Check product inventory and availability',
    parameters: [
      {
        name: 'productId',
        type: 'string',
        description: 'The product ID to check',
        required: true,
      },
    ],
  })
  async checkInventory(input: { productId: string }) {
    const inventory = await this.inventoryService.check(input.productId);

    if (!inventory) {
      return {
        productId: input.productId,
        inStock: false,
        message: 'Product not found',
      };
    }

    return {
      productId: input.productId,
      inStock: inventory.quantity > 0,
      quantity: inventory.quantity,
      availableDate: inventory.nextRestock,
    };
  }

  @Tool({
    description: 'Process a refund for an order',
    requiresApproval: true,
    timeout: 60000,
    parameters: [
      {
        name: 'orderId',
        type: 'string',
        description: 'The order ID to refund',
        required: true,
      },
      {
        name: 'amount',
        type: 'number',
        description: 'Refund amount in dollars',
        required: true,
      },
      {
        name: 'reason',
        type: 'string',
        description: 'Reason for refund',
        required: true,
      },
    ],
  })
  async processRefund(input: { orderId: string; amount: number; reason: string }) {
    const refund = await this.refundService.process({
      orderId: input.orderId,
      amount: input.amount,
      reason: input.reason,
    });

    return {
      success: true,
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status,
      estimatedProcessingDays: 5,
    };
  }

  @Tool({
    description: 'Update shipping address for an order',
    requiresApproval: true,
    parameters: [
      {
        name: 'orderId',
        type: 'string',
        description: 'The order ID',
        required: true,
      },
      {
        name: 'newAddress',
        type: 'object',
        description: 'New shipping address',
        required: true,
      },
    ],
  })
  async updateShippingAddress(input: { orderId: string; newAddress: Record<string, unknown> }) {
    const updated = await this.orderService.updateAddress(input.orderId, input.newAddress);

    if (!updated) {
      return { success: false, message: `Order ${input.orderId} not found` };
    }

    return {
      success: true,
      orderId: input.orderId,
      newAddress: updated.shippingAddress,
    };
  }

  @Tool({
    description: 'Create a support ticket for escalation or complex issues',
    parameters: [
      {
        name: 'subject',
        type: 'string',
        description: 'Brief subject of the ticket',
        required: true,
      },
      {
        name: 'description',
        type: 'string',
        description: 'Detailed description of the issue',
        required: true,
      },
      {
        name: 'priority',
        type: 'string',
        description: 'Priority: low, medium, high',
        required: false,
      },
    ],
  })
  async createTicket(input: {
    subject: string;
    description: string;
    priority?: string;
  }) {
    const ticket = await this.ticketService.create({
      subject: input.subject,
      description: input.description,
      priority: input.priority,
    });

    // Optionally enqueue for async processing (e.g., send notification)
    if (this.queueService) {
      try {
        await this.queueService.add('tickets', 'created', {
          ticketId: ticket.id,
          subject: ticket.subject,
        });
      } catch {
        // Queue not available - ticket still created
      }
    }

    return {
      success: true,
      ticketId: ticket.id,
      status: ticket.status,
      message: `Ticket ${ticket.id} created. Our team will follow up within 24 hours.`,
    };
  }

  @Tool({
    description: 'Search the knowledge base for FAQs, policies, and documentation',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'Search query for relevant documents',
        required: true,
      },
      {
        name: 'topK',
        type: 'number',
        description: 'Number of documents to retrieve (default: 5)',
        required: false,
      },
    ],
  })
  async searchKnowledgeBase(input: { query: string; topK?: number }) {
    const topK = input.topK || 5;

    try {
      const results = await this.ragService.search(input.query, {
        topK,
        includeMetadata: true,
        minScore: 0.5,
      });

      return {
        success: true,
        query: input.query,
        documents: results.map((result) => ({
          id: result.id,
          content: result.content,
          score: result.score,
          metadata: result.metadata || {},
        })),
        totalResults: results.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        documents: [],
      };
    }
  }
}
