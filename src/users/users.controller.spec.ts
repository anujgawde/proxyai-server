import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { FirebaseAuthGuard } from '../auth/guards/firebae-auth.guard';
import {
  createMockUser,
  createMockDecodedIdToken,
} from '../test/test-helpers';
import { SignUpDto } from './dto/sign-up.dto';
import { UpdateUserDto } from './dto/update-user.dto';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: Record<string, jest.Mock>;

  const mockUser = createMockUser();
  const mockDecodedToken = createMockDecodedIdToken();

  beforeEach(async () => {
    usersService = {
      signUp: jest.fn(),
      googleSignIn: jest.fn(),
      findById: jest.fn(),
      updateById: jest.fn(),
      deleteById: jest.fn(),
      findAll: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
      ],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /users/sign-up', () => {
    it('should call usersService.signUp with the provided DTO', async () => {
      const signUpDto: SignUpDto = {
        firebaseUid: 'uid-123',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        photoURL: null,
        metadata: {},
        emailVerified: true,
        authProvider: 'password',
      };

      usersService.signUp.mockResolvedValue(mockUser);

      const result = await controller.signUp(signUpDto);

      expect(usersService.signUp).toHaveBeenCalledWith(signUpDto);
      expect(result).toEqual(mockUser);
    });
  });

  describe('POST /users/google-sign-in', () => {
    it('should call usersService.googleSignIn with the provided DTO', async () => {
      const signUpDto: SignUpDto = {
        firebaseUid: 'uid-456',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        photoURL: 'https://photo.url/pic.jpg',
        metadata: {},
        emailVerified: true,
        authProvider: 'google.com',
      };

      usersService.googleSignIn.mockResolvedValue(mockUser);

      const result = await controller.googleSignIn(signUpDto);

      expect(usersService.googleSignIn).toHaveBeenCalledWith(signUpDto);
      expect(result).toEqual(mockUser);
    });
  });

  describe('GET /users/me', () => {
    it('should call usersService.findById with the current user uid', async () => {
      usersService.findById.mockResolvedValue(mockUser);

      const result = await controller.getCurrentUser(mockDecodedToken as any);

      expect(usersService.findById).toHaveBeenCalledWith(mockDecodedToken.uid);
      expect(result).toEqual(mockUser);
    });
  });

  describe('PATCH /users/me', () => {
    it('should call usersService.updateById with uid and update DTO', async () => {
      const updateDto: UpdateUserDto = { firstName: 'Updated' };
      const updatedUser = createMockUser({ firstName: 'Updated' });
      usersService.updateById.mockResolvedValue(updatedUser);

      const result = await controller.updateCurrentUser(
        mockDecodedToken as any,
        updateDto,
      );

      expect(usersService.updateById).toHaveBeenCalledWith(
        mockDecodedToken.uid,
        updateDto,
      );
      expect(result).toEqual(updatedUser);
    });
  });

  describe('DELETE /users/me', () => {
    it('should call usersService.deleteById with the current user uid', async () => {
      usersService.deleteById.mockResolvedValue(undefined);

      const result = await controller.deleteCurrentUser(
        mockDecodedToken as any,
      );

      expect(usersService.deleteById).toHaveBeenCalledWith(
        mockDecodedToken.uid,
      );
      expect(result).toBeUndefined();
    });
  });

  describe('GET /users', () => {
    it('should call usersService.findAll', async () => {
      const users = [mockUser];
      usersService.findAll.mockResolvedValue(users);

      const result = await controller.getAllUsers(mockDecodedToken as any);

      expect(usersService.findAll).toHaveBeenCalled();
      expect(result).toEqual(users);
    });
  });

  describe('GET /users/:id', () => {
    it('should call usersService.findById with the provided id param', async () => {
      usersService.findById.mockResolvedValue(mockUser);

      const result = await controller.getUserById('some-firebase-uid');

      expect(usersService.findById).toHaveBeenCalledWith('some-firebase-uid');
      expect(result).toEqual(mockUser);
    });
  });
});
