/**
 * CSR Service - Wires AgentRuntime, RAG, Memory, and business services
 */

import { Injectable } from '@hazeljs/core';
import { AgentEventType, AgentRuntime, AgentService } from '@hazeljs/agent';
import { HazelAI, type GraphExecutionResult } from '@hazeljs/ai';
import {
  createMemoryStore,
  MemoryCategory,
  MemoryService,
} from '@hazeljs/memory';
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
  private memoryService: MemoryService | null = null;

  constructor(
    private agentService: AgentService,
    private orderService: OrderService,
    private inventoryService: InventoryService,
    private refundService: RefundService,
    private ticketService: TicketService
  ) {
    const vectorStore = this.resolveVectorStore();
    this.ai = HazelAI.create({
      defaultProvider: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.1'),
      agentService: this.agentService as any,
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
    const store = createMemoryStore({ type: 'in-memory' });
    this.memoryService = new MemoryService(store);
    await this.memoryService.initialize();
    console.log('🚀 HazelAI Platform initialized (@hazeljs/memory in-memory store ready for HCEL)');
  }

  private ensureMemory(): MemoryService {
    if (!this.memoryService) {
      throw new Error('MemoryService not ready; ensure CSRService.initialize() ran at bootstrap');
    }
    return this.memoryService;
  }

  private ensureLLMProviderConfigured(): void {
    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    if (!openaiKey) {
      throw new Error(
        'OPENAI_API_KEY is not configured. Set it in your .env and restart the server.'
      );
    }
  }

  private buildChain(message: string, sessionId: string, userId?: string) {
    const toolHint = [
      'You are operating as csr-agent with tool access.',
      'If an order ID like ORD-12345 is present, call lookupOrder before asking follow-up questions.',
      'If the customer asks about stock, call checkInventory.',
      'If customer requests refund/address changes, use appropriate tools and approval workflow.',
      'Only ask for email/phone/order id if the needed identifier is missing.',
    ].join(' ');

    return this.ai.hazel
      .context({ sessionId, userId })
      .prompt(`${toolHint}\n\nCustomer request: ${message}`)
      .agent('csr-agent');
  }

  private toChatResponse(
    sid: string,
    payload: {
      response?: string;
      executionId?: string;
      steps?: unknown[];
      duration?: number;
    },
    mode?: ChatResponseDto['mode']
  ): ChatResponseDto {
    return {
      response: payload.response || 'I could not generate a response.',
      executionId: payload.executionId,
      sessionId: sid,
      steps: payload.steps?.length || 0,
      duration: payload.duration ?? 0,
      ...(mode ? { mode } : {}),
    };
  }

  private graphResultToChatResponse(
    sid: string,
    graph: GraphExecutionResult
  ): ChatResponseDto {
    let text = graph.response ?? graph.state?.output;
    if (text == null || text === '') {
      const nodes = graph.nodeExecutions
        ? Object.values(graph.nodeExecutions)
        : [];
      const last = nodes[nodes.length - 1] as { response?: string } | undefined;
      text = last?.response;
    }
    return {
      response: text || 'I could not generate a response.',
      executionId: graph.executionId,
      sessionId: sid,
      steps: Array.isArray(graph.steps) ? graph.steps.length : 0,
      duration: graph.duration ?? 0,
      mode: 'hcel-pipeline',
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
    this.ensureLLMProviderConfigured();
    const sid = sessionId || `session-${Date.now()}`;
    return this.chatViaRuntime(message, sid, userId);
  }

  /**
   * HCEL paths showcasing @hazeljs/memory recall (`variant: 'memory'`) and
   * `agentPipeline` / compiled graph execution (`variant: 'pipeline'`).
   */
  async chatHcel(
    message: string,
    variant: 'memory' | 'pipeline' = 'memory',
    sessionId?: string,
    userId?: string
  ): Promise<ChatResponseDto> {
    this.ensureLLMProviderConfigured();
    const sid = sessionId || `session-${Date.now()}`;

    if (variant === 'pipeline') {
      const graph = await this.ai.hazel
        .context({ sessionId: sid, userId })
        .agentPipeline({
          pipelineId: 'csr-example-linear',
          agents: ['csr-agent'],
        })
        .execute(message);
      return this.graphResultToChatResponse(sid, graph);
    }

    const memory = this.ensureMemory();
    const result = await this.ai.hazel
      .memory(memory)
      .context({ sessionId: sid, userId })
      .memoryRecall({
        category: [MemoryCategory.PREFERENCE, MemoryCategory.EPISODIC],
        limit: 12,
        header: 'Known customer context (from @hazeljs/memory):',
      })
      .agent('csr-agent')
      .execute(message);

    return this.toChatResponse(sid, result as any, 'hcel-memory');
  }

  /**
   * Save a demo preference so `chatHcel(..., 'memory')` can show recall in the same session/user.
   */
  async seedMemoryPreference(input: {
    userId: string;
    value: string;
    key?: string;
    sessionId?: string;
  }): Promise<{ id: string }> {
    const memory = this.ensureMemory();
    const item = await memory.save({
      userId: input.userId,
      sessionId: input.sessionId,
      category: MemoryCategory.PREFERENCE,
      key: input.key ?? 'csr-demo-preference',
      value: input.value,
      confidence: 1,
      source: 'explicit',
      evidence: [],
    });
    return { id: item.id };
  }

  async *chatStream(
    message: string,
    sessionId?: string,
    userId?: string
  ): AsyncGenerator<{ type: 'chunk'; text: string } | { type: 'result'; data: ChatResponseDto }> {
    this.ensureLLMProviderConfigured();
    const sid = sessionId || `session-${Date.now()}`;
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
    this.ensureLLMProviderConfigured();
    return this.ai.rag.ingest({
      type: 'text',
      content: `${title}\n\n${content}`,
      metadata: { title, ...metadata },
    });
  }
}
