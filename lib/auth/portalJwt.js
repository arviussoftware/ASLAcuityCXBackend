import jwt from "jsonwebtoken";

export function getJwtFromRequest(request) {
  const cookieToken = request.cookies.get("sessionToken")?.value;

  if (cookieToken) {
    return cookieToken;
  }

  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }

  return null;
}

export function verifyPortalJwt(request) {
  const token = getJwtFromRequest(request);

  if (!token) {
    throw new Error("TOKEN_MISSING");
  }

  if (!process.env.API_SECRET_KEY) {
    throw new Error("API_SECRET_KEY_MISSING");
  }

  try {
    return jwt.verify(token, process.env.API_SECRET_KEY);
  } catch {
    throw new Error("TOKEN_INVALID");
  }
}
