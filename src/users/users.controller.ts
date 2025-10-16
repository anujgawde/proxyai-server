import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { UsersService } from './users.service';
import { SignUpDto } from './dto/sign-up.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('sign-up')
  async signUp(@Body() signUpData: SignUpDto) {
    return await this.usersService.signUp(signUpData);
  }

  @Post('google-sign-in')
  async googleSignIn(@Body() signUpData: SignUpDto) {
    return await this.usersService.googleSignIn(signUpData);
  }

  @Get(':id')
  async getUser(@Param('id') id: string) {
    return await this.usersService.getUser(id);
  }
}
