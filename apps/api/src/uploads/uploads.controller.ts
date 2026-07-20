import { Controller, Post, UploadedFile, UseInterceptors, BadRequestException } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { randomUUID } from "crypto";
import { Public } from "../common/decorators";

export const UPLOADS_DIR = process.cwd() + "/uploads";

// Allowed types → the extension we control. The stored filename NEVER derives from
// the client-supplied originalname (which could be `x.html` and be served as HTML,
// enabling stored XSS). We only ever write a safe, server-chosen extension.
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "application/pdf": ".pdf",
};

@Controller("uploads")
export class UploadsController {
  // Public so a guest customer can upload a task photo before creating an account.
  @Public()
  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${ALLOWED_TYPES[file.mimetype] ?? ".bin"}`),
      }),
      limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
      fileFilter: (_req, file, cb) => {
        const ok = Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, file.mimetype);
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
