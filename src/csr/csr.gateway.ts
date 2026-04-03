/**
 * CSR WebSocket Gateway - Real-time chat with the agent
 */

import {
  Realtime,
  WebSocketGateway,
} from '@hazeljs/websocket';
import type { WebSocketClient, WebSocketMessage } from '@hazeljs/websocket';
import { CSRService } from './csr.service';

interface ChatMessage {
  text: string;
  sessionId?: string;
  userId?: string;
  /** When `memory` or `pipeline`, uses CSRService.chatHcel instead of streaming runtime. */
  hcelVariant?: 'memory' | 'pipeline';
}

@Realtime('/csr')
export class CSRGateway extends WebSocketGateway {
  constructor(private csrService: CSRService) {
    super();
  }

  private sendError(clientId: string, message: string): void {
    this.sendToClient(clientId, 'error', { message });
  }

  protected override handleConnection(client: WebSocketClient): void {
    super.handleConnection(client);
    client.send('connected', {
      message:
        'Connected to CSR agent. Send { event: "message", data: { text: "..." } }. Optional data.hcelVariant: "memory" | "pipeline" uses HCEL (non-streaming).',
      clientId: client.id,
      timestamp: new Date().toISOString(),
    });
  }

  protected override handleMessage(clientId: string, message: WebSocketMessage): void {
    super.handleMessage(clientId, message);

    if (message.event === 'message') {
      const data = (message.data || {}) as ChatMessage;
      const { text, sessionId, userId, hcelVariant } = data;

      if (!text || typeof text !== 'string') {
        this.sendError(clientId, 'Invalid message: text is required');
        return;
      }

      this.handleChatMessage(clientId, text, sessionId, userId, hcelVariant);
    }
  }

  private async handleChatMessage(
    clientId: string,
    text: string,
    sessionId?: string,
    userId?: string,
    hcelVariant?: 'memory' | 'pipeline'
  ): Promise<void> {
    const client = this.getClient(clientId);
    if (!client) return;

    try {
      client.send('thinking', { message: 'Processing your request...' });

      if (hcelVariant === 'memory' || hcelVariant === 'pipeline') {
        const data = await this.csrService.chatHcel(
          text,
          hcelVariant,
          sessionId,
          userId
        );
        client.send('response', {
          response: data.response,
          sessionId: data.sessionId,
          steps: data.steps,
          duration: data.duration,
          mode: data.mode,
          sources: data.sources,
        });
        return;
      }

      const stream = this.csrService.chatStream(text, sessionId, userId);

      for await (const event of stream) {
        if (event.type === 'chunk') {
          client.send('chunk', { text: event.text });
        } else if (event.type === 'result') {
          client.send('response', {
            response: event.data.response,
            sessionId: event.data.sessionId,
            steps: event.data.steps,
            duration: event.data.duration,
            sources: event.data.sources,
          });
        }
      }
    } catch (error) {
      this.sendError(clientId, error instanceof Error ? error.message : 'Unknown error');
    }
  }
}
