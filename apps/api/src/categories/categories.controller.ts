import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { Role } from "@prisma/client";
import { CategoriesService } from "./categories.service";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto";
import { Public, Roles } from "../common/decorators";

@Controller("categories")
export class CategoriesController {
  constructor(private categories: CategoriesService) {}

  @Public()
  @Get()
  list() {
    return this.categories.listActive();
  }

  @Roles(Role.ADMIN)
  @Get("all")
  listAll() {
    return this.categories.listAll();
  }

  @Public()
  @Get(":slug")
  bySlug(@Param("slug") slug: string) {
    return this.categories.bySlug(slug);
  }

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Roles(Role.ADMIN)
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete(":id")
  deactivate(@Param("id") id: string) {
    return this.categories.deactivate(id);
  }
}
