/**
 * CSR Service - Wires AgentRuntime, RAG, Memory, and business services
 */

import { Injectable } from '@hazeljs/core';
import { AgentEventType, AgentRuntime, AgentService } from '@hazeljs/agent';
import { HazelAI } from '@hazeljs/ai';
import { OrderService } from '../services/order.service';
import { InventoryService } from '../services/inventory.service';
import { RefundService } from '../services/refund.service';
import { TicketService } from '../services/ticket.service';
import { CSRAgent } from './csr.agent';
import { QueueService } from '@hazeljs/queue';
import type { ChatResponseDto } from './csr.types';

@Injectable()
export class CSRService {
  private ai: HazelAI;
  private runtime: AgentRuntime;
  private queueService?: QueueService;

  constructor(
    private agentService: AgentService,
    private orderService: OrderService,
    private inventoryService: InventoryService,
    private refundService: RefundService,
    private ticketService: TicketService
  ) {
    const vectorStore = this.resolveVectorStore();
    this.ai = HazelAI.create({
      providers: {
        openai: { apiKey: process.env.OPENAI_API_KEY || '' },
      },
      persistence: {
        rag: {
          vectorStore: vectorStore as any,
          apiKey: process.env.PINECONE_API_KEY,
          connectionString: process.env.QDRANT_URL,
          indexName:
            process.env.PINECONE_INDEX ||
            process.env.QDRANT_COLLECTION ||
            'csr-knowledge',
        },
      },
    });

    this.queueService = this.createQueueService();

    this.runtime = this.agentService.getRuntime();
    const agent = new CSRAgent(
      {
        orderService: this.orderService,
        inventoryService: this.inventoryService,
        refundService: this.refundService,
        ticketService: this.ticketService,
      },
      this.ai.rag as any,
      this.queueService
    );

    this.registerAgentSafely(agent);

    this.runtime.on(AgentEventType.TOOL_APPROVAL_REQUESTED, (event: any) => {
      const requestId = event.data?.requestId;
      if (requestId) {
        setTimeout(() => {
          try {
            this.runtime.approveToolExecution(requestId, 'auto-timeout');
          } catch {
            // Request was likely handled already.
          }
        }, 30000);
      }
    });
  }

  private registerAgentSafely(agent: CSRAgent): void {
    try {
      this.runtime.registerAgent(CSRAgent as any);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('already registered')) {
        throw error;
      }
    }

    try {
      this.runtime.registerAgentInstance('csr-agent', agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('already registered')) {
        throw error;
      }
    }
  }

  private resolveVectorStore(): 'pinecone' | 'qdrant' | 'in-memory' {
    if (process.env.PINECONE_API_KEY) return 'pinecone';
    if (process.env.QDRANT_URL) return 'qdrant';
    return 'in-memory';
  }

  private createQueueService(): QueueService | undefined {
    try {
      if (!process.env.REDIS_HOST) return undefined;
      const queue = new QueueService();
      queue.setConnection({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      });
      return queue;
    } catch {
      return undefined;
    }
  }

  async initialize(): Promise<void> {
    console.log('🚀 HazelAI Platform initialized');
  }

  private buildChain(message: string, sessionId: string, userId?: string) {
    return this.ai.hazel
      .context({ sessionId, userId })
      .prompt(`Customer request: ${message}`)
      .agent('csr-agent');
  }

  private toChatResponse(
    sid: string,
    payload: {
      response?: string;
      executionId?: string;
      steps?: unknown[];
      duration?: number;
    }
  ): ChatResponseDto {
    return {
      response: payload.response || 'I could not generate a response.',
      executionId: payload.executionId,
      sessionId: sid,
      steps: payload.steps?.length || 0,
      duration: payload.duration ?? 0,
    };
  }

  private async chatViaRuntime(
    message: string,
    sid: string,
    userId?: string
  ): Promise<ChatResponseDto> {
    const result = await this.runtime.execute('csr-agent', message, {
      sessionId: sid,
      userId,
    } as any);
    return this.toChatResponse(sid, result as any);
  }

  async chat(
    message: string,
    sessionId?: string,
    userId?: string
  ): Promise<ChatResponseDto> {
    const sid = sessionId || `session-${Date.now()}`;
    try {
      const startedAt = Date.now();
      const result = await this.buildChain(message, sid, userId).execute();
      return this.toChatResponse(sid, {
        response: typeof result === 'string' ? result : JSON.stringify(result),
        executionId: `hcel-${startedAt}`,
        steps: [{ type: 'hcel' }],
        duration: Date.now() - startedAt,
      });
    } catch {
      return this.chatViaRuntime(message, sid, userId);
    }
  }

  async *chatStream(
    message: string,
    sessionId?: string,
    userId?: string
  ): AsyncGenerator<{ type: 'chunk'; text: string } | { type: 'result'; data: ChatResponseDto }> {
    const sid = sessionId || `session-${Date.now()}`;
    const startedAt = Date.now();

    try {
      let combinedText = '';
      for await (const chunk of this.buildChain(message, sid, userId).stream()) {
        const text = String(chunk);
        combinedText += text;
        yield { type: 'chunk', text };
      }
      yield {
        type: 'result',
        data: this.toChatResponse(sid, {
          response: combinedText,
          executionId: `hcel-${startedAt}`,
          steps: [{ type: 'hcel' }],
          duration: Date.now() - startedAt,
        }),
      };
      return;
    } catch {
      // Keep runtime as compatibility fallback for environments where HCEL agent isn't configured.
    }

    for await (const chunk of this.runtime.executeStream('csr-agent', message, {
      sessionId: sid,
      userId,
    } as any)) {
      if (chunk.type === 'token') {
        yield { type: 'chunk', text: chunk.content };
      } else if (chunk.type === 'done') {
        yield { type: 'result', data: this.toChatResponse(sid, chunk.result as any) };
      }
    }
  }

  approveTool(requestId: string, approved: boolean, approvedBy: string): void {
    if (approved) {
      this.runtime.approveToolExecution(requestId, approvedBy);
    } else {
      this.runtime.rejectToolExecution(requestId);
    }
  }

  getPlatform(): HazelAI {
    return this.ai;
  }

  async ingestDocument(
    title: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<string[]> {
    return this.ai.rag.ingest({
      type: 'text',
      content: `${title}\n\n${content}`,
      metadata: { title, ...metadata },
    });
  }
}
