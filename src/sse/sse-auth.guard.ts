// src/common/guards/sse-auth.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import * as admin from 'firebase-admin';

/**
 * Guard for SSE endpoints
 * Extracts token from query param (EventSource limitation)
 * Attaches user to request so @CurrentUser() decorator works
 */
@Injectable()
export class SseAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Extract token from query params (EventSource can't use headers)
    const token = request.query?.token;

    if (!token) {
      throw new UnauthorizedException('Authentication token required');
    }

    try {
      // Verify Firebase token (same as your existing auth)
      const decodedToken = await admin.auth().verifyIdToken(token);

      // Attach user to request (same as your existing auth guard does)
      request.user = decodedToken;

      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid authentication token');
    }
  }
}
