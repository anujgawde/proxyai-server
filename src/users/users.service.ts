import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, AuthProviderEnum } from '../entities/user.entity';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import * as admin from 'firebase-admin';
import { SignUpDto } from './dto/sign-up.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  // private getAuthProviderFromToken(
  //   decodedToken: admin.auth.DecodedIdToken,
  // ): AuthProviderEnum {
  //   const signInProvider = decodedToken.firebase?.sign_in_provider;
  //   const providers = decodedToken.firebase?.identities || {};

  //   if (signInProvider === 'google.com' || providers['google.com']) {
  //     return AuthProviderEnum.GOOGLE;
  //   }

  //   return AuthProviderEnum.EMAIL;
  // }

  async signUp(signUpData: SignUpDto): Promise<User> {
    try {
      const existingUser = await this.usersRepository.findOne({
        where: [{ email: signUpData.email }],
      });
      console.log(signUpData, existingUser);
      if (existingUser) {
        return existingUser;
      }
      const authProvider =
        signUpData.authProvider === 'google.com'
          ? AuthProviderEnum.GOOGLE
          : AuthProviderEnum.EMAIL;
      const user = this.usersRepository.create({
        firebaseUid: signUpData.firebaseUid,
        email: signUpData.email,
        firstName: signUpData.firstName,
        lastName: signUpData.lastName,
        photoURL: signUpData.photoURL,
        emailVerified: signUpData.emailVerified,
        authProvider,
        metadata: signUpData.metadata,
      });
      return await this.usersRepository.save(user);
    } catch (error) {
      throw new Error(`Failed to sign up user: ${error.message}`);
    }
  }

  async googleSignIn(signUpData: SignUpDto): Promise<User> {
    try {
      let existingUser = await this.usersRepository.findOne({
        where: { email: signUpData.email },
      });
      console.log(signUpData, existingUser);
      if (existingUser) {
        return existingUser;
      }

      const authProvider =
        signUpData.authProvider === 'google.com'
          ? AuthProviderEnum.GOOGLE
          : AuthProviderEnum.EMAIL;

      const newUser = this.usersRepository.create({
        firebaseUid: signUpData.firebaseUid,
        email: signUpData.email,
        firstName: signUpData.firstName,
        lastName: signUpData.lastName,
        photoURL: signUpData.photoURL,
        emailVerified: signUpData.emailVerified,
        authProvider,
        metadata: signUpData.metadata,
      });

      try {
        const savedUser = await this.usersRepository.save(newUser);
        return savedUser;
      } catch (error: any) {
        // Race condition where user was created between checks
        if (error.code === '23505') {
          // PostgreSQL unique violation
          const existingUser = await this.usersRepository.findOne({
            where: [
              { firebaseUid: signUpData.firebaseUid },
              { email: signUpData.email },
            ],
          });
          if (existingUser) {
            return existingUser;
          }
        }
        throw error;
      }
    } catch (error) {
      throw new Error(`Failed to sign in user: ${error.message}`);
    }
  }

  async getUser(id: string): Promise<User> {
    try {
      const user = await this.usersRepository.findOne({
        where: { firebaseUid: id },
      });

      if (!user) {
        throw new NotFoundException(`User with Firebase UID ${id} not found`);
      }

      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to get user: ${error.message}`,
      );
    }
  }
}
