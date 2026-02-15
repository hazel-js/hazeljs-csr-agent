/**
 * CSR API types
 */

export interface ChatRequestDto {
  message: string;
  sessionId?: string;
  userId?: string;
}

export interface ChatResponseDto {
  response: string;
  executionId?: string;
  sessionId: string;
  steps: number;
  duration: number;
  sources?: Array<{
    id: string;
    content: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
}

export interface IngestDocumentDto {
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalRequestDto {
  requestId: string;
  approved: boolean;
  approvedBy: string;
}
