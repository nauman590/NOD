import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { existsSync, mkdirSync } from "fs";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { UPLOADS_DIR } from "./uploads/uploads.controller";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Security headers. This is a JSON API + cross-origin static file host (the web app runs
  // on a different origin), so CSP is left to the web app and CORP is set to cross-origin
  // so the browser will load /uploads images from here; the rest of helmet's hardening
  // (HSTS, X-Content-Type-Options: nosniff, frameguard, etc.) is applied.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  // CORS origins from env (comma-separated); "*" reflects any origin. When wildcard, we
  // must NOT also send credentials — reflecting an arbitrary origin WITH credentials lets
  // any site make credentialed cross-origin requests. (Auth here is a Bearer header, not a
  // cookie, so disabling credentials on wildcard is safe.)
  const corsEnv = (process.env.CORS_ORIGINS || "http://localhost:5173").trim();
  const corsWildcard = corsEnv === "*";
  app.enableCors({
    origin: corsWildcard ? true : corsEnv.split(",").map((s) => s.trim()),
    credentials: !corsWildcard,
  });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));

  // Allow larger JSON bodies (defensive; photos now go through /api/uploads instead).
  app.useBodyParser("json", { limit: "20mb" });
  app.useBodyParser("urlencoded", { limit: "20mb", extended: true });

  // Serve uploaded files at /uploads/<filename>
  if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
  app.useStaticAssets(UPLOADS_DIR, { prefix: "/uploads/" });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}/api`);
}
bootstrap();
