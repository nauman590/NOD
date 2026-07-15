import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { EstimateService } from "./estimate.service";
import { CreateEstimateDto } from "./dto";
import { Public } from "../common/decorators";

@Controller("estimate")
export class EstimateController {
  constructor(private estimate: EstimateService) {}

  // Public: a guest can price a task before creating an account.
  // If a valid token is present the customerId is attached for traceability.
  @Public()
  @Post()
  create(@Body() dto: CreateEstimateDto, @Req() req: any) {
    return this.estimate.create(dto, req.user?.id);
  }

  @Public()
  @Get(":id")
  get(@Param("id") id: string) {
    return this.estimate.get(id);
  }
}
