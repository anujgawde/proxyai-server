import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export interface SSEPayload {
  type: string;
  [key: string]: any;
}

// Todo: clear and start from scratch
@Injectable()
export class SseService {
  private readonly logger = new Logger(SseService.name);
  private userStreams = new Map<string, Subject<SSEPayload>>();
  private heartbeats = new Map<string, NodeJS.Timeout>();

  subscribe(userId: string): Observable<SSEPayload> {
    if (!this.userStreams.has(userId)) {
      const subject = new Subject<SSEPayload>();
      this.userStreams.set(userId, subject);

      const heartbeat = setInterval(() => {
        subject.next({ type: 'ping', timestamp: new Date().toISOString() });
      }, 25000); // 25s heartbeat

      this.heartbeats.set(userId, heartbeat);

      subject.next({
        type: 'connected',
        userId,
        timestamp: new Date().toISOString(),
      });
      this.logger.log(`SSE connected | user=${userId}`);
    }

    const subject = this.userStreams.get(userId)!;

    return new Observable<SSEPayload>((subscriber) => {
      const sub = subject.subscribe(subscriber);

      return () => {
        sub.unsubscribe();
        if (subject.observers.length === 0) {
          clearInterval(this.heartbeats.get(userId));
          this.heartbeats.delete(userId);
          this.userStreams.delete(userId);
          this.logger.log(`SSE disconnected | user=${userId}`);
        }
      };
    });
  }

  sendUserUpdate(userId: string, payload: SSEPayload) {
    const subject = this.userStreams.get(userId);
    if (!subject) return;
    subject.next(payload);
  }
}
