import { PromiseCache } from "../../core/promise-cache.ts";

interface AccessAdminSettings {
  OPEN_CONNECTOR_ACCESS_CONSOLE_ORIGIN?: string;
  OPEN_CONNECTOR_ACCESS_TEAM_DOMAIN?: string;
  OPEN_CONNECTOR_ACCESS_AUDIENCE?: string;
}

type AdminRequestVerifier = (request: Request) => Promise<boolean>;

const verifiers = new PromiseCache<AdminRequestVerifier>();

export function accessAdminVerifier(settings: AccessAdminSettings): Promise<AdminRequestVerifier> {
  const origin = settings.OPEN_CONNECTOR_ACCESS_CONSOLE_ORIGIN?.trim();
  const team = settings.OPEN_CONNECTOR_ACCESS_TEAM_DOMAIN?.trim();
  const audience = settings.OPEN_CONNECTOR_ACCESS_AUDIENCE?.trim();
  return verifiers.get(JSON.stringify([origin, team, audience]), async () => {
    if (!origin || !team || !audience || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) return async () => false;

    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    const issuer = `https://${team}`;
    const keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
    return async (request) => {
      if (new URL(request.url).origin !== origin) return false;
      if (request.method !== "GET" && request.method !== "HEAD" && request.headers.get("origin") !== origin) {
        return false;
      }
      const token = request.headers.get("Cf-Access-Jwt-Assertion");
      if (!token) return false;

      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer,
          audience,
          algorithms: ["RS256"],
          requiredClaims: ["exp", "sub"],
        });
        return typeof payload.email === "string" && payload.email.length > 0;
      } catch {
        return false;
      }
    };
  });
}
