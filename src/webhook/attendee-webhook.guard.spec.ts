import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { AttendeeWebhookGuard } from './attendee-webhook.guard';

/**
 * Helper: reproduce the same signing logic the guard uses internally so we
 * can produce valid signatures for testing.
 */
function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((acc: any, key: string) => {
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

describe('AttendeeWebhookGuard', () => {
  let guard: AttendeeWebhookGuard;
  const SECRET_B64 = Buffer.from('test-webhook-secret').toString('base64');

  beforeEach(() => {
    guard = new AttendeeWebhookGuard();
    process.env.BOT_STATE_WEBHOOK_SECRET = SECRET_B64;
  });

  afterEach(() => {
    delete process.env.BOT_STATE_WEBHOOK_SECRET;
  });

  function buildContext(
    body: any,
    headers: Record<string, string> = {},
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ body, headers }),
      }),
    } as unknown as ExecutionContext;
  }

  it('should return true when the signature is valid', () => {
    const body = { event: 'bot.status_change', status: 'done' };
    const signature = signPayload(body, SECRET_B64);
    const ctx = buildContext(body, { 'x-webhook-signature': signature });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw UnauthorizedException when x-webhook-signature header is missing', () => {
    const body = { event: 'bot.status_change' };
    const ctx = buildContext(body, {});

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow('Missing webhook signature');
  });

  it('should throw Error when BOT_STATE_WEBHOOK_SECRET is not configured', () => {
    delete process.env.BOT_STATE_WEBHOOK_SECRET;

    const body = { event: 'test' };
    const ctx = buildContext(body, {
      'x-webhook-signature': 'some-signature',
    });

    expect(() => guard.canActivate(ctx)).toThrow(Error);
    expect(() => guard.canActivate(ctx)).toThrow(
      'ATTENDEE_WEBHOOK_SECRET not configured',
    );
  });

  it('should throw UnauthorizedException when the signature does not match', () => {
    const body = { event: 'bot.status_change' };
    // Sign with a different secret so the result has the same byte length but different value
    const wrongSecret = Buffer.from('wrong-webhook-secret').toString('base64');
    const wrongSig = signPayload(body, wrongSecret);
    const ctx = buildContext(body, {
      'x-webhook-signature': wrongSig,
    });

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow('Invalid webhook signature');
  });

  it('should handle nested JSON bodies and sort keys canonically', () => {
    // Keys deliberately in non-alphabetical order
    const body = {
      z_field: 'last',
      a_field: 'first',
      nested: {
        b_key: 2,
        a_key: 1,
      },
    };
    const signature = signPayload(body, SECRET_B64);
    const ctx = buildContext(body, { 'x-webhook-signature': signature });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should handle array values in the body', () => {
    const body = {
      items: [
        { z: 1, a: 2 },
        { c: 3, b: 4 },
      ],
      event: 'test',
    };
    const signature = signPayload(body, SECRET_B64);
    const ctx = buildContext(body, { 'x-webhook-signature': signature });

    expect(guard.canActivate(ctx)).toBe(true);
  });
});
