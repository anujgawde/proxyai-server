import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User, AuthProviderEnum } from '../entities/user.entity';
import { createMockRepository, createMockUser } from '../test/test-helpers';

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: ReturnType<typeof createMockRepository>;

  beforeEach(async () => {
    userRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('signUp', () => {
    const signUpData = {
      firebaseUid: 'uid-1',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      photoURL: null,
      emailVerified: true,
      authProvider: 'password',
      metadata: {},
    };

    it('should return existing user when email already exists', async () => {
      const existingUser = createMockUser();
      userRepo.findOne.mockResolvedValueOnce(existingUser);

      const result = await service.signUp(signUpData as any);

      expect(result).toBe(existingUser);
      expect(userRepo.create).not.toHaveBeenCalled();
    });

    it('should create and save a new user when email does not exist', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);
      const newUser = createMockUser({ firebaseUid: 'uid-1' });
      userRepo.create.mockReturnValueOnce(newUser);
      userRepo.save.mockResolvedValueOnce(newUser);

      const result = await service.signUp(signUpData as any);

      expect(userRepo.create).toHaveBeenCalled();
      expect(userRepo.save).toHaveBeenCalledWith(newUser);
      expect(result).toBe(newUser);
    });

    it('should set authProvider to GOOGLE when authProvider is "google.com"', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);

      await service.signUp({ ...signUpData, authProvider: 'google.com' } as any);

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ authProvider: AuthProviderEnum.GOOGLE }),
      );
    });

    it('should set authProvider to EMAIL when authProvider is not "google.com"', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);

      await service.signUp(signUpData as any);

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ authProvider: AuthProviderEnum.EMAIL }),
      );
    });

    it('should throw Error wrapping the original message on failure', async () => {
      userRepo.findOne.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(service.signUp(signUpData as any)).rejects.toThrow(
        'Failed to sign up user: DB connection lost',
      );
    });
  });

  describe('googleSignIn', () => {
    const signUpData = {
      firebaseUid: 'uid-1',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      photoURL: null,
      emailVerified: true,
      authProvider: 'google.com',
      metadata: {},
    };

    it('should return existing user when email already exists', async () => {
      const existingUser = createMockUser();
      userRepo.findOne.mockResolvedValueOnce(existingUser);

      const result = await service.googleSignIn(signUpData as any);

      expect(result).toBe(existingUser);
      expect(userRepo.create).not.toHaveBeenCalled();
    });

    it('should create and save new user when email does not exist', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);
      const newUser = createMockUser();
      userRepo.create.mockReturnValueOnce(newUser);
      userRepo.save.mockResolvedValueOnce(newUser);

      const result = await service.googleSignIn(signUpData as any);

      expect(userRepo.create).toHaveBeenCalled();
      expect(result).toBe(newUser);
    });

    it('should handle race condition: return existing user on PostgreSQL 23505 unique violation', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);
      const dbError = new Error('duplicate key') as any;
      dbError.code = '23505';
      userRepo.save.mockRejectedValueOnce(dbError);

      const existingUser = createMockUser();
      userRepo.findOne.mockResolvedValueOnce(existingUser);

      const result = await service.googleSignIn(signUpData as any);

      expect(result).toBe(existingUser);
    });

    it('should re-throw non-23505 database errors', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);
      const dbError = new Error('connection timeout') as any;
      dbError.code = '42000';
      userRepo.save.mockRejectedValueOnce(dbError);

      await expect(service.googleSignIn(signUpData as any)).rejects.toThrow(
        'Failed to sign in user: connection timeout',
      );
    });

    it('should throw when 23505 recovery finds no user', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);
      const dbError = new Error('duplicate key') as any;
      dbError.code = '23505';
      userRepo.save.mockRejectedValueOnce(dbError);
      userRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.googleSignIn(signUpData as any)).rejects.toThrow();
    });
  });

  describe('findById', () => {
    it('should return user when found by firebaseUid', async () => {
      const user = createMockUser();
      userRepo.findOne.mockResolvedValueOnce(user);

      const result = await service.findById('firebase-uid-1');

      expect(result).toBe(user);
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { firebaseUid: 'firebase-uid-1' },
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw InternalServerErrorException on unexpected repository error', async () => {
      userRepo.findOne.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.findById('uid-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('updateById', () => {
    it('should update firstName when provided', async () => {
      const user = createMockUser();
      userRepo.findOne.mockResolvedValueOnce(user);
      userRepo.save.mockResolvedValueOnce({ ...user, firstName: 'NewName' });

      const result = await service.updateById('firebase-uid-1', {
        firstName: 'NewName',
      });

      expect(result.firstName).toBe('NewName');
    });

    it('should update lastName when provided', async () => {
      const user = createMockUser();
      userRepo.findOne.mockResolvedValueOnce(user);
      userRepo.save.mockResolvedValueOnce({ ...user, lastName: 'NewLast' });

      const result = await service.updateById('firebase-uid-1', {
        lastName: 'NewLast',
      });

      expect(result.lastName).toBe('NewLast');
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updateById('nonexistent', { firstName: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw InternalServerErrorException on unexpected error', async () => {
      userRepo.findOne.mockRejectedValueOnce(new Error('DB failure'));

      await expect(
        service.updateById('uid-1', { firstName: 'Test' }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
