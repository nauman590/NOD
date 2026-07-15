import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto";

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  listActive() {
    return this.prisma.category.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  }

  listAll() {
    return this.prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
  }

  async bySlug(slug: string) {
    const cat = await this.prisma.category.findUnique({ where: { slug } });
    if (!cat) throw new NotFoundException("category not found");
    return cat;
  }

  create(dto: CreateCategoryDto) {
    return this.prisma.category.create({ data: { ...dto, intakeConfig: dto.intakeConfig as any } });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const exists = await this.prisma.category.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("category not found");
    return this.prisma.category.update({
      where: { id },
      data: { ...dto, intakeConfig: dto.intakeConfig !== undefined ? (dto.intakeConfig as any) : undefined },
    });
  }

  async deactivate(id: string) {
    const exists = await this.prisma.category.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("category not found");
    return this.prisma.category.update({ where: { id }, data: { active: false } });
  }
}
