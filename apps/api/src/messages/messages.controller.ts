import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { IsString, MinLength } from "class-validator";
import { MessagesService } from "./messages.service";
import { CurrentUser, AuthUser } from "../common/decorators";

class SendMessageDto {
  @IsString() @MinLength(1) body!: string;
}

@Controller("jobs/:id/messages")
export class MessagesController {
  constructor(private messages: MessagesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.messages.list(id, user);
  }

  @Post()
  send(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: SendMessageDto) {
    return this.messages.send(id, user, dto.body);
  }
}
