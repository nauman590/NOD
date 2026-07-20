import { Controller, Post, UploadedFile, UseInterceptors, BadRequestException } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { diskStorage } from "multer";
import { randomUUID } from "crypto";
import { openSync, readSync, closeSync, unlinkSync } from "fs";
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

// Sniff the real file type from its leading bytes. multer's fileFilter only sees the
// CLIENT-supplied mimetype, which is trivially spoofable (a script uploaded as image/png).
// Returns the detected mime, or null if it's not one we allow.
function sniffMime(filePath: string): string | null {
  const fd = openSync(filePath, "r");
  const buf = Buffer.alloc(16);
  let n = 0;
  try {
    n = readSync(fd, buf, 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  if (n < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf"; // %PDF
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.slice(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.slice(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(brand)) return "image/heic";
  }
  return null;
}

@Controller("uploads")
export class UploadsController {
  // Public so a guest customer can upload a task photo before creating an account. Capped
  // per IP so the unauthenticated endpoint can't be used to flood the disk.
  @Throttle({ default: { limit: 30, ttl: 60000 } })
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
    // Verify the file's ACTUAL bytes match an allowed type and its claimed mimetype — the
    // fileFilter above trusts the client's Content-Type, which is spoofable. On mismatch,
    // delete the file we just wrote and reject.
    const detected = sniffMime(file.path);
    if (!detected || ALLOWED_TYPES[detected] !== ALLOWED_TYPES[file.mimetype]) {
      try {
        unlinkSync(file.path);
      } catch {
        /* best-effort cleanup */
      }
      throw new BadRequestException("file content does not match its declared type");
    }
    const base = process.env.PUBLIC_API_URL || "http://localhost:3001";
    return { url: `${base}/uploads/${file.filename}`, filename: file.filename, size: file.size };
  }
}
