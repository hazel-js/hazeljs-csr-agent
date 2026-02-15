/**
 * CSR Service - Wires AgentRuntime, RAG, Memory, and business services
 */

import { Injectable } from '@hazeljs/core';
import {
  AgentRuntime,
  AgentEventType,
} from '@hazeljs/agent';
import {
  RAGService,
  MemoryManager,
  BufferMemory,
  MemoryVectorStore,
  PineconeVectorStore,
  QdrantVectorStore,
  OpenAIEmbeddings,
  RecursiveTextSplitter,
} from '@hazeljs/rag';
import { OpenAIProvider } from '@hazeljs/ai';
import { OrderService } from '../services/order.service';
import { InventoryService } from '../services/inventory.service';
import { RefundService } from '../services/refund.service';
import { TicketService } from '../services/ticket.service';
import { CSRAgent } from './csr.agent';
import { QueueService } from '@hazeljs/queue';
import type { ChatResponseDto } from './csr.types';

@Injectable()
export class CSRService {
  private runtime: AgentRuntime;
  private ragService: RAGService;
  private memoryManager: MemoryManager;
  private approvalHandlers: Map<
    string,
    { resolve: (approved: boolean) => void; approvedBy?: string }
  > = new Map();
  private queueService?: QueueService;

  constructor(
    private orderService: OrderService,
    private inventoryService: InventoryService,
    private refundService: RefundService,
    private ticketService: TicketService
  ) {
    // Initialize RAG
    const embeddings = new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY || '',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });

    const vectorStore = this.createVectorStore(embeddings);
    const textSplitter = new RecursiveTextSplitter({
      chunkSize: 500,
      chunkOverlap: 50,
    });

    this.ragService = new RAGService({
      vectorStore,
      embeddingProvider: embeddings,
      textSplitter,
      topK: 5,
    });

    // Initialize Memory
    const bufferStore = new BufferMemory({ maxSize: 100 });
    this.memoryManager = new MemoryManager(bufferStore, {
      maxConversationLength: 20,
      summarizeAfter: 50,
      entityExtraction: true,
    });

    // Initialize LLM provider adapter
    const openaiProvider = new OpenAIProvider(process.env.OPENAI_API_KEY || '', {
      defaultModel: 'gpt-4-turbo-preview',
    });

    const llmProvider = {
      chat: async (options: {
        messages: Array<{ role: string; content: string; name?: string }>;
        tools?: Array<{ function?: { name: string; description: string; parameters: unknown }; name?: string; description?: string; parameters?: unknown }>;
        temperature?: number;
        maxTokens?: number;
      }) => {
        const functions = options.tools?.map((tool) => {
          const t = tool.function || tool;
          const params = t.parameters as { type?: string; properties?: Record<string, unknown>; required?: string[] };
          return {
            name: t.name,
            description: t.description,
            parameters: {
              type: 'object',
              properties: params?.properties || {},
              required: params?.required,
            },
          };
        });

        const response = await openaiProvider.complete({
          messages: options.messages.map((m) => ({
            role: m.role as 'system' | 'user' | 'assistant',
            content: m.content,
          })),
          temperature: options.temperature ?? 0.7,
          maxTokens: options.maxTokens ?? 2000,
          functions: functions && functions.length > 0 ? (functions as never) : undefined,
        });

        return {
          content: response.content,
          tool_calls: response.functionCall
            ? [
                {
                  id: response.id,
                  type: 'function' as const,
                  function: {
                    name: response.functionCall.name,
                    arguments: response.functionCall.arguments,
                  },
                },
              ]
            : response.toolCalls?.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                },
              })) || [],
        };
      },
    };

    // Create AgentRuntime
    this.runtime = new AgentRuntime({
      memoryManager: this.memoryManager,
      llmProvider,
      ragService: this.ragService as never,
      defaultMaxSteps: 15,
      enableObservability: true,
      rateLimitPerMinute: 60,
      enableCircuitBreaker: true,
      enableRetry: true,
    });

    // Optional: QueueService for async ticket processing (when Redis is configured)
    try {
      const redisHost = process.env.REDIS_HOST || 'localhost';
      const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
      const qs = new QueueService();
      qs.setConnection({ host: redisHost, port: redisPort });
      this.queueService = qs;
    } catch {
      this.queueService = undefined;
    }

    // Register agent
    const agent = new CSRAgent(
      this.orderService,
      this.inventoryService,
      this.refundService,
      this.ticketService,
      this.ragService as never,
      this.queueService
    );

    this.runtime.registerAgent(CSRAgent as never);
    this.runtime.registerAgentInstance('csr-agent', agent);

    // Approval handler - stores pending approvals for controller to resolve
    this.runtime.on(AgentEventType.TOOL_APPROVAL_REQUESTED, (event: { data?: { requestId: string } }) => {
      const requestId = event.data?.requestId;
      if (requestId && this.approvalHandlers.has(requestId)) {
        // Will be resolved when controller calls approve/reject
        return;
      }
      // Auto-approve after 30s if no handler (for demo)
      if (requestId) {
        setTimeout(() => {
          if (this.approvalHandlers.has(requestId)) return;
          this.runtime.approveToolExecution(requestId, 'auto-timeout');
        }, 30000);
      }
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.ragService.initialize();
    } catch {
      // Vector store (Pinecone/Qdrant) unreachable; fall back to in-memory silently
      const embeddings = new OpenAIEmbeddings({
        apiKey: process.env.OPENAI_API_KEY || '',
        model: 'text-embedding-3-small',
        dimensions: 1536,
      });
      const fallbackStore = new MemoryVectorStore(embeddings);
      this.ragService = new RAGService({
        vectorStore: fallbackStore,
        embeddingProvider: embeddings,
        textSplitter: new RecursiveTextSplitter({ chunkSize: 500, chunkOverlap: 50 }),
        topK: 5,
      });
      await this.ragService.initialize();
      (this.runtime as unknown as { config: { ragService?: RAGService } }).config.ragService =
        this.ragService as never;
    }
    await this.memoryManager.initialize();
  }

  async chat(
    message: string,
    sessionId?: string,
    userId?: string
  ): Promise<ChatResponseDto> {
    const sid = sessionId || `session-${Date.now()}`;

    const result = await this.runtime.execute('csr-agent', message, {
      sessionId: sid,
      userId,
      enableMemory: true,
      enableRAG: true,
    });

    // Extract sources from searchKnowledgeBase tool results
    const sources: ChatResponseDto['sources'] = [];
    for (const step of result.steps) {
      const action = step.action as { type?: string; toolName?: string };
      if (action?.type === 'use_tool' && action.toolName === 'searchKnowledgeBase') {
        const output = (step.result as { output?: { documents?: Array<{ id: string; content: string; score: number; metadata?: Record<string, unknown> }> } })?.output;
        if (output?.documents) {
          for (const doc of output.documents) {
            sources.push({
              id: doc.id,
              content: doc.content,
              score: doc.score,
              metadata: doc.metadata,
            });
          }
        }
      }
    }

    return {
      response: result.response || 'I could not generate a response.',
      executionId: result.executionId,
      sessionId: sid,
      steps: result.steps.length,
      duration: result.duration ?? 0,
      sources: sources.length > 0 ? sources : undefined,
    };
  }

  approveTool(requestId: string, approved: boolean, approvedBy: string): void {
    if (approved) {
      this.runtime.approveToolExecution(requestId, approvedBy);
    } else {
      this.runtime.rejectToolExecution(requestId);
    }
    const handler = this.approvalHandlers.get(requestId);
    if (handler) {
      handler.resolve(approved);
      handler.approvedBy = approvedBy;
      this.approvalHandlers.delete(requestId);
    }
  }

  getRuntime(): AgentRuntime {
    return this.runtime;
  }

  getRAGService(): RAGService {
    return this.ragService;
  }

  async ingestDocument(
    title: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<string[]> {
    return this.ragService.index({
      content: `${title}\n\n${content}`,
      metadata: { title, ...metadata },
    });
  }

  /**
   * Create vector store: Pinecone if PINECONE_API_KEY is set, else Qdrant if QDRANT_URL,
   * else in-memory MemoryVectorStore. Empty keys/URLs are treated as unset.
   */
  private createVectorStore(
    embeddings: OpenAIEmbeddings
  ): MemoryVectorStore | PineconeVectorStore | QdrantVectorStore {
    const pineconeKey = process.env.PINECONE_API_KEY?.trim();
    const qdrantUrl = process.env.QDRANT_URL?.trim();

    if (pineconeKey) {
      try {
        return new PineconeVectorStore(embeddings, {
          apiKey: pineconeKey,
          environment: process.env.PINECONE_ENVIRONMENT || 'us-east-1-aws',
          indexName: process.env.PINECONE_INDEX || 'csr-knowledge',
        });
      } catch {
        // Fall back to memory silently (e.g. package not installed)
      }
    }

    if (qdrantUrl) {
      try {
        return new QdrantVectorStore(embeddings, {
          url: qdrantUrl,
          collectionName: process.env.QDRANT_COLLECTION || 'csr-knowledge',
        });
      } catch {
        // Fall back to memory silently (e.g. package not installed)
      }
    }

    return new MemoryVectorStore(embeddings);
  }
}
