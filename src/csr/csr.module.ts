/**
 * CSR Module - Agent CSR with RAG, Memory, REST, WebSocket
 */

import { HazelModule } from '@hazeljs/core';
import { OrderService } from '../services/order.service';
import { InventoryService } from '../services/inventory.service';
import { RefundService } from '../services/refund.service';
import { TicketService } from '../services/ticket.service';
import { CSRService } from './csr.service';
import { CSRController } from './csr.controller';
import { CSRGateway } from './csr.gateway';

@HazelModule({
  providers: [
    OrderService,
    InventoryService,
    RefundService,
    TicketService,
    CSRService,
    CSRGateway,
  ],
  controllers: [CSRController],
  exports: [CSRService],
})
export class CSRModule {}
