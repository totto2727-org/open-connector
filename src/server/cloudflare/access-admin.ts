import { PromiseCache } from "../../core/promise-cache.ts";

interface AccessAdminSettings {
  OPEN_CONNECTOR_ACCESS_CONSOLE_ORIGIN?: string;
  OPEN_CONNECTOR_ACCESS_TEAM_DOMAIN?: string;
  OPEN_CONNECTOR_ACCESS_AUDIENCE?: string;
}

type AdminRequestVerifier = (request: Request) => Promise<boolean>;
type AccessSubjectVerifier = (request: Request) => Promise<string | undefined>;

const verifiers = new PromiseCache<AdminRequestVerifier>();
const subjectVerifiers = new PromiseCache<AccessSubjectVerifier>();

export function accessAdminVerifier(settings: AccessAdminSettings): Promise<AdminRequestVerifier> | undefined {
  const origin = settings.OPEN_CONNECTOR_ACCESS_CONSOLE_ORIGIN?.trim();
  const team = settings.OPEN_CONNECTOR_ACCESS_TEAM_DOMAIN?.trim();
  const audience = settings.OPEN_CONNECTOR_ACCESS_AUDIENCE?.trim();
  if (origin === undefined && team === undefined && audience === undefined) return undefined;

  return verifiers.get(JSON.stringify([origin, team, audience]), async () => {
    if (!origin) return async () => false;
    return async (request) => {
      if (new URL(request.url).origin !== origin) return false;
      if (request.method !== "GET" && request.method !== "HEAD" && request.headers.get("origin") !== origin) {
        return false;
      }
      return (await verifyAccessSubject(request, settings)) !== undefined;
    };
  });
}

/** Verify the assertion injected by Access, without accepting browser cookies or API credentials. */
export async function verifyAccessSubject(
  request: Request,
  settings: AccessAdminSettings,
): Promise<string | undefined> {
  const team = settings.OPEN_CONNECTOR_ACCESS_TEAM_DOMAIN?.trim();
  const audience = settings.OPEN_CONNECTOR_ACCESS_AUDIENCE?.trim();
  if (!team || !audience || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) return undefined;

  const verify = await subjectVerifiers.get(JSON.stringify([team, audience]), async () => {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    const issuer = `https://${team}`;
    const keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
    return async (assertedRequest) => {
      const token = assertedRequest.headers.get("Cf-Access-Jwt-Assertion");
      if (!token) return undefined;

      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer,
          audience,
          algorithms: ["RS256"],
          requiredClaims: ["exp", "sub"],
        });
        if (typeof payload.email !== "string" || !payload.email || !payload.sub?.trim()) return undefined;
        return payload.sub;
      } catch {
        return undefined;
      }
    };
  });
  return verify(request);
}
