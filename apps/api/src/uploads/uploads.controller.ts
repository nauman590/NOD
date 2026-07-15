import { Controller, Post, UploadedFile, UseInterceptors, BadRequestException } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { randomUUID } from "crypto";
import { extname } from "path";
import { Public } from "../common/decorators";

export const UPLOADS_DIR = process.cwd() + "/uploads";

@Controller("uploads")
export class UploadsController {
  // Public so a guest customer can upload a task photo before creating an account.
  @Public()
  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname) || ".jpg"}`),
      }),
      limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
      fileFilter: (_req, file, cb) => {
        const ok = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"].includes(file.mimetype);
        cb(ok ? null : new BadRequestException("unsupported file type"), ok);
      },
    }),
  )
  upload(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException("no file");
    const base = process.env.PUBLIC_API_URL || "http://localhost:3001";
    return { url: `${base}/uploads/${file.filename}`, filename: file.filename, size: file.size };
  }
}
