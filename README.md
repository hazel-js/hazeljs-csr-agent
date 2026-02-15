# HazelJS Agent CSR Example

Full-fledged Agent CSR (Customer Service Representative) example using @hazeljs packages: Agent, AI, RAG, Memory, Queue, WebSocket.

## Features

- **AI Agent** - Stateful CSR agent with tools (order lookup, inventory, refunds, tickets, knowledge search)
- **RAG** - Retrieval-augmented generation for FAQ and documentation
- **Memory** - Conversation memory with BufferMemory (dev) / HybridMemory (prod)
- **Approval Workflow** - Human-in-the-loop for refunds and address updates
- **REST API** - POST /api/csr/chat, /api/csr/chat/stream, /api/csr/ingest, /api/csr/approve
- **WebSocket** - Real-time chat at ws://localhost:3001/csr
- **Queue** - Optional async ticket creation (Redis/BullMQ)
- **Production** - Rate limiting, circuit breaker, retry, health checks

## Quick Start

```bash
# Install dependencies
npm install

# Set OpenAI API key
export OPENAI_API_KEY=your-key

# Run
npm run dev
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/csr/chat | Send message to agent (sync) |
| POST | /api/csr/chat/stream | SSE stream response |
| POST | /api/csr/ingest | Ingest document into knowledge base |
| POST | /api/csr/approve | Approve/reject tool execution |
| GET | /api/csr/health | Agent health check |

## WebSocket

Connect to `ws://localhost:3001/csr` and send:

```json
{ "event": "message", "data": { "text": "What is my order status for ORD-12345?", "sessionId": "user-123" } }
```

## Environment Variables

See `.env.example` for full list. Key variables:

- `OPENAI_API_KEY` - Required for AI
- `REDIS_HOST`, `REDIS_PORT` - Optional, for Queue (async tickets)
- `PINECONE_API_KEY` - Optional, for production RAG (uses Pinecone when set)
- `QDRANT_URL` - Optional, for production RAG (uses Qdrant when set, if no Pinecone)
- `PORT` - HTTP server (default 3000)
- `WS_PORT` - WebSocket server (default 3001)
- `NODE_ENV=production` - Enables production features (rate limit, circuit breaker)

## Production

For production, consider:
- Redis for agent state: Add `redis` package and use `RedisStateManager` with AgentRuntime
- Vector DB for memory: Use `HybridMemory` with Pinecone/Qdrant instead of BufferMemory
- Redis for Queue: Set REDIS_HOST for async ticket processing

## Ingest Knowledge Base

```bash
curl -X POST http://localhost:3000/api/csr/ingest \
  -H "Content-Type: application/json" \
  -d '{"title": "Refund Policy", "content": "Full refunds within 30 days..."}'
```

## Chat Example

```bash
curl -X POST http://localhost:3000/api/csr/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the status of order ORD-12345?", "sessionId": "customer-1"}'
```

## Postman

Import the collection and environment for easy testing:

1. **Import** → Upload `hazeljs-csr-agent.postman_collection.json`
2. **Import** → Upload `hazeljs-csr-agent.postman_environment.json`
3. Select the "HazelJS CSR - Local" environment
4. Run requests (Health Check first, then Chat, Ingest, etc.)

Recommended flow: Health Check → Ingest documents → Chat (order/inventory) → Chat (RAG query)
