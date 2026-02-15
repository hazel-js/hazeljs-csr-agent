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
}

@Realtime('/csr')
export class CSRGateway extends WebSocketGateway {
  constructor(private csrService: CSRService) {
    super();
  }

  protected override handleConnection(client: WebSocketClient): void {
    super.handleConnection(client);
    client.send('connected', {
      message: 'Connected to CSR agent. Send { event: "message", data: { text: "..." } }',
      clientId: client.id,
      timestamp: new Date().toISOString(),
    });
  }

  protected override handleMessage(clientId: string, message: WebSocketMessage): void {
    super.handleMessage(clientId, message);

    if (message.event === 'message') {
      const data = (message.data || {}) as ChatMessage;
      const { text, sessionId, userId } = data;

      if (!text || typeof text !== 'string') {
        this.sendToClient(clientId, 'error', { message: 'Invalid message: text is required' });
        return;
      }

      this.handleChatMessage(clientId, text, sessionId, userId);
    }
  }

  private async handleChatMessage(
    clientId: string,
    text: string,
    sessionId?: string,
    userId?: string
  ): Promise<void> {
    const client = this.getClient(clientId);
    if (!client) return;

    try {
      client.send('thinking', { message: 'Processing your request...' });

      const result = await this.csrService.chat(text, sessionId, userId);

      client.send('response', {
        response: result.response,
        sessionId: result.sessionId,
        steps: result.steps,
        duration: result.duration,
        sources: result.sources,
      });
    } catch (error) {
      client.send('error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
