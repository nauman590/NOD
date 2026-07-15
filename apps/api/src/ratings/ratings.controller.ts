import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { RatingsService } from "./ratings.service";
import { CurrentUser, AuthUser, Public } from "../common/decorators";

class RateDto {
  @IsInt() @Min(1) @Max(5) stars!: number;
  @IsOptional() @IsString() comment?: string;
}

@Controller()
export class RatingsController {
  constructor(private ratings: RatingsService) {}

  @Post("jobs/:id/rate")
  rate(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: RateDto) {
    return this.ratings.rate(id, user.id, dto.stars, dto.comment);
  }

  @Public()
  @Get("providers/:userId/ratings")
  list(@Param("userId") userId: string) {
    return this.ratings.providerRatings(userId);
  }
}
