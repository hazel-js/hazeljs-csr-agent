/**
 * CSR Example - Full-fledged Agent CSR with AI, RAG, Memory
 */

import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { HazelApp } from '@hazeljs/core';
import { AppModule } from './app.module';
import { SwaggerModule } from '@hazeljs/swagger';
import { CSRGateway } from './csr/csr.gateway';
import { CSRService } from './csr/csr.service';
import logger from '@hazeljs/core';

const PORT = parseInt(process.env.PORT || '3000', 10);
const WS_PORT = parseInt(process.env.WS_PORT || '3001', 10);

async function bootstrap(): Promise<void> {
  const app = new HazelApp(AppModule);
  SwaggerModule.setRootModule(AppModule);

  await app.listen(PORT);

  // Initialize CSR service (RAG, memory)
  try {
    const container = app.getContainer();
    const csrService = container.resolve(CSRService);
    await csrService.initialize();
    logger.info('CSR service initialized');
  } catch (err) {
    logger.warn('CSR service init:', err);
  }

  // Start WebSocket server for real-time CSR chat
  try {
    const container = app.getContainer();
    const csrGateway = container.resolve(CSRGateway);
    csrGateway.listen(WS_PORT, { path: '/csr' });
    logger.info(`WebSocket CSR gateway listening on ws://localhost:${WS_PORT}/csr`);
  } catch (err) {
    logger.warn('WebSocket gateway not started:', err);
  }
}

bootstrap().catch((err) => {
  logger.error('Bootstrap failed:', err);
  process.exit(1);
});
