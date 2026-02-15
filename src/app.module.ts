/**
 * App Module - Full-fledged Agent CSR example
 */

import { HazelModule, ValidationPipe } from '@hazeljs/core';
import { ConfigModule } from '@hazeljs/config';
import { CacheModule } from '@hazeljs/cache';
import { SwaggerModule } from '@hazeljs/swagger';
import { CSRModule } from './csr/csr.module';

@HazelModule({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.env', '.env.local'],
      isGlobal: true,
    }) as never,
    CacheModule.forRoot({
      strategy: 'memory',
      isGlobal: true,
    }) as never,
    CSRModule,
    SwaggerModule,
  ],
  providers: [ValidationPipe],
})
export class AppModule {}
