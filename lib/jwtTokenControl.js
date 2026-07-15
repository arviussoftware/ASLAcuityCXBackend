import * as jose from "jose";

const jwtConfig = {
  secret: new TextEncoder().encode(process.env.API_SECRET_KEY),
};

export async function isAuthenticated(req, outParams) {
  try {
    let token =
      req.headers.get("authorization") || req.headers.get("Authorization");

    if (token) {
      try {
        if (token.startsWith("Bearer")) {
          token = token.replace("Bearer ", "");
        }
        const decoded = await jose.jwtVerify(token, jwtConfig.secret);
        if (decoded.payload?.apiusername) {
          outParams.message = "Authentication successful.";
          return true;
        } else {
          outParams.message = "Invalid token: missing apiusername.";
          return false;
        }
      } catch (err) {
        outParams.message = err.message;
        return false;
      }
    } else {
      outParams.message = "Authorization header missing.";
      return false;
    }
  } catch (err) {
    outParams.message = "Authorization header missing.";
    return false;
  }
}
