import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { UsersService } from './users.service';
import { SignUpDto } from './dto/sign-up.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { FirebaseAuthGuard } from 'src/auth/guards/firebae-auth.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Public endpoints (no guard)
  @Post('sign-up')
  async signUp(@Body() signUpDto: SignUpDto) {
    return this.usersService.signUp(signUpDto);
  }

  @Post('google-sign-in')
  async googleSignIn(@Body() signUpDto: SignUpDto) {
    return this.usersService.googleSignIn(signUpDto);
  }

  @Get('me')
  @UseGuards(FirebaseAuthGuard)
  async getCurrentUser(@CurrentUser() user: DecodedIdToken) {
    return this.usersService.findById(user.uid);
  }

  @Patch('me')
  @UseGuards(FirebaseAuthGuard)
  async updateCurrentUser(
    @CurrentUser() user: DecodedIdToken,
    @Body() updateDto: UpdateUserDto,
  ) {
    return this.usersService.updateById(user.uid, updateDto);
  }

  @Delete('me')
  @UseGuards(FirebaseAuthGuard)
  async deleteCurrentUser(@CurrentUser() user: DecodedIdToken) {
    return this.usersService.deleteById(user.uid);
  }

  // Admin or specific use cases
  @Get()
  @UseGuards(FirebaseAuthGuard)
  async getAllUsers(@CurrentUser() user: DecodedIdToken) {
    // You can add role checking here
    return this.usersService.findAll();
  }

  @Get(':id')
  @UseGuards(FirebaseAuthGuard)
  async getUserById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  @UseGuards(FirebaseAuthGuard)
  async updateUser(@Param('id') id: string, @Body() updateDto: UpdateUserDto) {
    return this.usersService.updateById(id, updateDto);
  }
}
