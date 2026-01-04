import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';

function sortKeys(value: any): any {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeys(value[key]);
        return acc;
      }, {});
  }

  return value;
}

function signPayload(payload: any, secretB64: string): string {
  const canonical = JSON.stringify(sortKeys(payload));
  const secretBuf = Buffer.from(secretB64, 'base64');

  return crypto
    .createHmac('sha256', secretBuf)
    .update(canonical, 'utf8')
    .digest('base64');
}

@Injectable()
export class AttendeeWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const signatureFromHeader = req.headers['x-webhook-signature'];

    if (!signatureFromHeader) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const secret = process.env.BOT_STATE_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error('ATTENDEE_WEBHOOK_SECRET not configured');
    }

    const calculatedSignature = signPayload(req.body, secret);

    if (
      !crypto.timingSafeEqual(
        Buffer.from(signatureFromHeader),
        Buffer.from(calculatedSignature),
      )
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
