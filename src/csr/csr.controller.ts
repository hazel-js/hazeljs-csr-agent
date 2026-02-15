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
  ChatRequestDto,
  ChatResponseDto,
  IngestDocumentDto,
  ApprovalRequestDto,
} from './csr.types';
import { IsString, IsOptional, IsBoolean, IsObject } from 'class-validator';

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

@Swagger({
  title: 'CSR Agent API',
  description: 'AI-powered Customer Service Representative with RAG and Memory',
  version: '1.0.0',
  tags: [{ name: 'csr', description: 'Customer support agent' }],
})
@Controller({ path: 'api/csr' })
export class CSRController {
  constructor(private csrService: CSRService) {}

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
    @Res() res: { setHeader: (n: string, v: string) => void; write: (d: string) => void; end: () => void }
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const result = await this.csrService.chat(dto.message, dto.sessionId, dto.userId);
      res.write(`data: ${JSON.stringify({ type: 'response', data: result })}\n\n`);
    } catch (error) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`);
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
    const runtime = this.csrService.getRuntime();
    try {
      const result = await (runtime as { healthCheck?: () => Promise<unknown> }).healthCheck?.();
      return { status: 'ok', ...(result as object) };
    } catch {
      return { status: 'degraded' };
    }
  }
}
