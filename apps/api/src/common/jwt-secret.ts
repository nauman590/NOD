import { ConfigService } from "@nestjs/config";

// Minimum acceptable length for an HS256 signing secret. ~32 random chars carries
// enough entropy to be infeasible to brute-force; anything shorter is guessable.
const MIN_SECRET_LENGTH = 32;

// Public placeholders shipped in .env.example / docs. If the running config still
// carries one of these the secret is effectively world-known — anyone could forge a
// token for any user (including admin), so it must be rejected at boot.
const KNOWN_PLACEHOLDERS = new Set(["dev_access_secret_change_me", "dev_refresh_secret_change_me"]);

function assertStrongSecret(name: string, raw: string | undefined): string {
  const secret = (raw ?? "").trim();
  if (!secret) {
    throw new Error(`${name} is not set. Configure a long random secret (>= ${MIN_SECRET_LENGTH} chars, e.g. \`openssl rand -hex 48\`).`);
  }
  const normalized = secret.toLowerCase();
  if (KNOWN_PLACEHOLDERS.has(secret) || normalized.includes("change_me") || normalized.includes("changeme")) {
    throw new Error(`${name} is set to a public placeholder value — rotate it to a long random secret (\`openssl rand -hex 48\`).`);
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} is too short (${secret.length} chars); use at least ${MIN_SECRET_LENGTH} random chars.`);
  }
  return secret;
}

// Resolve the access-token signing secret, failing closed if it is missing, too short,
// or still a known placeholder. Used everywhere the secret is needed (token signing,
// the passport strategy, the JWT modules, the realtime gateway) so there is exactly one
// enforcement point and no `|| "dev_..."` fallback can silently open the door.
export function getAccessSecret(config: ConfigService): string {
  return assertStrongSecret("JWT_ACCESS_SECRET", config.get<string>("JWT_ACCESS_SECRET"));
}
