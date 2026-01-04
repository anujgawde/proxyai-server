// src/sse/sse.controller.ts
import { Controller, Sse, Query, Logger, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SseService, SSEPayload } from './sse.service';
import { SseAuthGuard } from './sse-auth.guard';

@Controller('sse')
export class SseController {
  private readonly logger = new Logger(SseController.name);

  constructor(private readonly sseService: SseService) {}

  // @UseGuards(SseAuthGuard)
  @Sse('connect')
  userSse(@Query('userId') userId: string): Observable<MessageEvent> {
    this.logger.log(`User SSE connected: ${userId}`);

    // Subscribe to user stream
    const stream$ = this.sseService.subscribe(userId);

    // Map SSEPayload -> MessageEvent
    return new Observable<MessageEvent>((observer) => {
      const sub = stream$.subscribe({
        next: (payload) =>
          observer.next({ data: JSON.stringify(payload) } as MessageEvent),
        error: (err) => observer.error(err),
        complete: () => observer.complete(),
      });

      return () => {
        sub.unsubscribe();
        this.logger.log(`User SSE disconnected: ${userId}`);
      };
    });
  }
}
