import { SignJWT, jwtVerify } from "jose";

const JWT_ALGORITHM = "HS256";
const ACCESS_TOKEN_EXPIRY = "1h";

export function validateMcpConfig(): void {
  const secret = process.env.MCP_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "MCP_JWT_SECRET must be set and at least 32 characters long"
    );
  }
}

function getSigningKey(): Uint8Array {
  validateMcpConfig();
  const secret = process.env.MCP_JWT_SECRET as string;
  return new TextEncoder().encode(secret);
}

export interface AccessTokenPayload {
  userId: string;
  workspaceId: string | null;
}

export async function createAccessToken(
  userId: string,
  workspaceId: string | null
): Promise<string> {
  const key = getSigningKey();

  return new SignJWT({ wid: workspaceId })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(key);
}

export async function verifyAccessToken(
  token: string
): Promise<AccessTokenPayload> {
  const key = getSigningKey();

  const { payload } = await jwtVerify(token, key, {
    algorithms: [JWT_ALGORITHM],
  });

  const userId = payload.sub;
  const workspaceId = (payload.wid as string) ?? null;

  if (!userId) {
    throw new Error("Invalid token: missing subject");
  }

  return { userId, workspaceId };
}
