/**
 * Ticket Service - Mock implementation for CSR agent
 * Creates support tickets; can be queued for async processing
 */

export interface Ticket {
  id: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  createdAt: Date;
}

export class TicketService {
  private tickets: Map<string, Ticket> = new Map();

  async create(data: {
    subject: string;
    description: string;
    priority?: string;
  }): Promise<Ticket> {
    const id = 'TKT-' + Date.now();
    const ticket: Ticket = {
      id,
      subject: data.subject,
      description: data.description,
      priority: data.priority || 'medium',
      status: 'open',
      createdAt: new Date(),
    };
    this.tickets.set(id, ticket);
    return ticket;
  }

  async getById(id: string): Promise<Ticket | null> {
    return this.tickets.get(id) || null;
  }
}
