import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { FirebaseAuthGuard } from './firebae-auth.guard';
import { FirebaseService } from '../firebase.service';

describe('FirebaseAuthGuard', () => {
  let guard: FirebaseAuthGuard;
  let firebaseService: { verifyIdToken: jest.Mock };

  beforeEach(() => {
    firebaseService = {
      verifyIdToken: jest.fn(),
    };
    guard = new FirebaseAuthGuard(firebaseService as unknown as FirebaseService);
  });

  function buildContext(headers: Record<string, string> = {}): ExecutionContext {
    const request = { headers, user: undefined as any };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  it('should return true and set request.user for a valid Bearer token', async () => {
    const decoded = { uid: 'user-123', email: 'test@example.com' };
    firebaseService.verifyIdToken.mockResolvedValue(decoded);

    const ctx = buildContext({ authorization: 'Bearer valid-token' });
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    const request = ctx.switchToHttp().getRequest();
    expect(request.user).toEqual(decoded);
    expect(firebaseService.verifyIdToken).toHaveBeenCalledWith('valid-token');
  });

  it('should throw UnauthorizedException when no authorization header is present', async () => {
    const ctx = buildContext({});

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'No authentication token provided',
    );
  });

  it('should throw UnauthorizedException when authorization header does not start with Bearer', async () => {
    const ctx = buildContext({ authorization: 'Basic some-credentials' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'No authentication token provided',
    );
  });

  it('should throw UnauthorizedException when authorization header is "Bearer " with no token following', async () => {
    // "Bearer " with nothing after it produces an empty string token.
    // The guard passes this to verifyIdToken which rejects.
    firebaseService.verifyIdToken.mockRejectedValue(new Error('invalid'));

    const ctx = buildContext({ authorization: 'Bearer ' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Invalid or expired token',
    );
  });

  it('should throw UnauthorizedException when verifyIdToken rejects (invalid token)', async () => {
    firebaseService.verifyIdToken.mockRejectedValue(
      new Error('Firebase ID token has expired'),
    );

    const ctx = buildContext({ authorization: 'Bearer expired-token' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Invalid or expired token',
    );
  });

  it('should extract the token correctly by stripping the "Bearer " prefix', async () => {
    const token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abc.xyz';
    firebaseService.verifyIdToken.mockResolvedValue({ uid: 'u1' });

    const ctx = buildContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx);

    expect(firebaseService.verifyIdToken).toHaveBeenCalledTimes(1);
    expect(firebaseService.verifyIdToken).toHaveBeenCalledWith(token);
  });

  it('should not set request.user when an error occurs', async () => {
    firebaseService.verifyIdToken.mockRejectedValue(new Error('bad'));

    const ctx = buildContext({ authorization: 'Bearer bad-token' });
    const request = ctx.switchToHttp().getRequest();

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });

  it('should reject when the header is just the word "Bearer" without a trailing space', async () => {
    const ctx = buildContext({ authorization: 'Bearer' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'No authentication token provided',
    );
    expect(firebaseService.verifyIdToken).not.toHaveBeenCalled();
  });
});
