/**
 * CSR REST Controller - Chat and document ingestion endpoints
 */

import {
  Controller,
  Post,
  Get,
  Body,
  UsePipes,
  ValidationPipe,
  Res,
} from '@hazeljs/core';
import { Swagger, ApiOperation } from '@hazeljs/swagger';
import { CSRService } from './csr.service';
import {
  ChatResponseDto,
} from './csr.types';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  IsIn,
} from 'class-validator';

class ChatRequest {
  @IsString()
  message!: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

class IngestRequest {
  @IsString()
  title!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class ApprovalRequest {
  @IsString()
  requestId!: string;

  @IsBoolean()
  approved!: boolean;

  @IsString()
  approvedBy!: string;
}

class HcelChatRequest {
  @IsString()
  message!: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['memory', 'pipeline'])
  variant?: 'memory' | 'pipeline';
}

class MemorySeedRequest {
  @IsString()
  userId!: string;

  @IsString()
  value!: string;

  @IsOptional()
  @IsString()
  key?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;
}

@Swagger({
  title: 'CSR Agent API',
  description: 'AI-powered Customer Service Representative with RAG and Memory',
  version: '1.0.0',
  tags: [{ name: 'csr', description: 'Customer support agent' }],
})
@Controller({ path: 'api/csr' })
export class CSRController {
  constructor(private csrService: CSRService) {}

  private writeSSE(res: any, payload: Record<string, unknown>): void {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  @Post('/chat')
  @ApiOperation({
    summary: 'Send a message to the CSR agent',
    description: 'Returns AI response with optional RAG sources',
    tags: ['csr'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['message'],
            properties: {
              message: { type: 'string', example: 'What is the status of my order ORD-12345?' },
              sessionId: { type: 'string', example: 'user-session-123' },
              userId: { type: 'string', example: 'user-456' },
            },
          },
        },
      },
    },
    responses: {
      '200': { description: 'Agent response' },
      '400': { description: 'Invalid request' },
    },
  })
  @UsePipes(ValidationPipe)
  async chat(@Body() dto: ChatRequest): Promise<ChatResponseDto> {
    return this.csrService.chat(dto.message, dto.sessionId, dto.userId);
  }

  @Post('/chat/hcel')
  @ApiOperation({
    summary: 'Chat via HCEL (memory recall or agent pipeline)',
    description:
      'variant=memory: chains .memory() → .memoryRecall() → .agent("csr-agent"). variant=pipeline: .agentPipeline() with csr-agent (GraphExecutionResult).',
    tags: ['csr'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['message'],
            properties: {
              message: { type: 'string' },
              sessionId: { type: 'string' },
              userId: { type: 'string' },
              variant: { type: 'string', example: 'memory' },
            },
          },
        },
      },
    },
    responses: {
      '200': { description: 'Agent response; mode field indicates HCEL path used' },
    },
  })
  @UsePipes(ValidationPipe)
  async chatHcel(@Body() dto: HcelChatRequest): Promise<ChatResponseDto> {
    return this.csrService.chatHcel(
      dto.message,
      dto.variant ?? 'memory',
      dto.sessionId,
      dto.userId
    );
  }

  @Post('/memory/seed')
  @ApiOperation({
    summary: 'Seed a preference for HCEL memory recall demo',
    description:
      'Stores a PREFERENCE item; use the same userId (and optional sessionId) with POST /chat/hcel variant=memory to see recall.',
    tags: ['csr'],
  })
  @UsePipes(ValidationPipe)
  async seedMemory(@Body() dto: MemorySeedRequest): Promise<{ id: string }> {
    return this.csrService.seedMemoryPreference({
      userId: dto.userId,
      value: dto.value,
      key: dto.key,
      sessionId: dto.sessionId,
    });
  }

  @Post('/chat/stream')
  @ApiOperation({
    summary: 'Stream chat response (SSE)',
    description: 'Server-Sent Events stream of agent response',
    tags: ['csr'],
    responses: {
      '200': { description: 'SSE stream' },
    },
  })
  @UsePipes(ValidationPipe)
  async chatStream(
    @Body() dto: ChatRequest,
    @Res() res: any
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const stream = this.csrService.chatStream(dto.message, dto.sessionId, dto.userId);
      for await (const event of stream) {
        const payload = event.type === 'chunk'
          ? { type: 'chunk', text: event.text }
          : { type: 'response', data: event.data };
        this.writeSSE(res, payload);
      }
    } catch (error) {
      this.writeSSE(res, { type: 'error', error: String(error) });
    } finally {
      res.end();
    }
  }

  @Post('/ingest')
  @ApiOperation({
    summary: 'Ingest document into knowledge base',
    description: 'Add FAQ or policy document for RAG retrieval',
    tags: ['csr'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['title', 'content'],
            properties: {
              title: { type: 'string' },
              content: { type: 'string' },
              metadata: { type: 'object' },
            },
          },
        },
      },
    },
    responses: {
      '201': { description: 'Document ingested' },
    },
  })
  @UsePipes(ValidationPipe)
  async ingest(@Body() dto: IngestRequest): Promise<{ ids: string[] }> {
    const ids = await this.csrService.ingestDocument(
      dto.title,
      dto.content,
      dto.metadata
    );
    return { ids };
  }

  @Post('/approve')
  @ApiOperation({
    summary: 'Approve or reject tool execution',
    description: 'For tools requiring human approval (e.g. processRefund)',
    tags: ['csr'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['requestId', 'approved', 'approvedBy'],
            properties: {
              requestId: { type: 'string' },
              approved: { type: 'boolean' },
              approvedBy: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @UsePipes(ValidationPipe)
  async approve(@Body() dto: ApprovalRequest): Promise<{ success: boolean }> {
    this.csrService.approveTool(dto.requestId, dto.approved, dto.approvedBy);
    return { success: true };
  }

  @Get('/health')
  @ApiOperation({
    summary: 'Agent health check',
    tags: ['csr'],
  })
  async health(): Promise<Record<string, unknown>> {
    const ai = this.csrService.getPlatform();
    try {
      // In 0.7.0 we probe metrics or specific facade status
      const metrics = ai.getMetrics();
      return { status: 'ok', metrics };
    } catch {
      return { status: 'degraded' };
    }
  }
}
