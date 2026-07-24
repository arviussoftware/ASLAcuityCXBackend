export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { executeStoredProcedure, outputmsgParams } from "@/lib/sql.js";
import { logAudit } from "@/lib/auditLogger";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import jwt from "jsonwebtoken";
import { setUsersLoginModel } from "@/lib/models/userlogin";
import {
  getStoredLicense,
  isLicenseExpired,
  getActiveModuleIds,
} from "@/lib/licenseService";
import { isInvalid } from "@/lib/generic";
import CryptoJS from "crypto-js";
import { isRateLimited } from "@/lib/rateLimit";
import { z } from "zod";

const loginSchema = z.object({
  username: z.string().max(150, "Username is too long").optional(),
  password: z.string().max(100, "Password is too long").optional(),
  email: z.string().max(255, "Email is too long").optional(),
  authType: z.enum(["domain", "sso"]).default("domain"),
}).refine(data => {
  if (data.authType === "sso") {
    return !!data.email && z.string().email().safeParse(data.email).success;
  }
  return !!data.username && !!data.password;
}, {
  message: "Invalid login credentials format.",
});

// ✅ Centralized SP message constants — no more scattered hardcoded strings
const LOGIN_MESSAGES = {
  INVALID_CREDENTIALS: "You have entered invalid credentials.",
  USER_NOT_FOUND:
    "You are not authorized to login due to user not existing or being inactive in the system.",
  ACCOUNT_NOT_EXISTS: "Your account does not exists.",
  SSO_EMAIL_NOT_FOUND: "SSO email does not exist in the system.",
  LOGIN_SUCCESS: "Login successful",
  SSO_SUCCESS: "SSO login successful",
};

export async function POST(request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || "127.0.0.1";
    if (isRateLimited(ip, "login", 5, 60 * 1000)) {
      await logWarning("POST /api/auth/login", "Rate limit exceeded.", { ip });
      return NextResponse.json(
        { message: "Too many login attempts. Please try again in a minute." },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const payload = body?.payload;
    const secretKey =
      process.env.NEXT_PUBLIC_CLIENT_ENCRYPT_KEY ||
      process.env.NEXT_PUBLIC_ENCRYPTION_KEY;

    let decryptedData = body;

    if (typeof payload === "string" && payload.trim()) {
      if (!secretKey) {
        await logError(
          "POST /api/auth/login",
          new Error("Server encryption key is not configured."),
        );
        return NextResponse.json(
          { message: "Server encryption key is not configured." },
          { status: 500 },
        );
      }

      try {
        const bytes = CryptoJS.AES.decrypt(payload, secretKey);
        const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
        decryptedData = decryptedText ? JSON.parse(decryptedText) : {};
      } catch (decryptError) {
        await logError("POST /api/auth/login", decryptError, {
          reason: "Payload decryption failed",
        });
        return NextResponse.json(
          { message: "Invalid login payload." },
          { status: 400 },
        );
      }
    }

    // Zod Validation Check
    const validationResult = loginSchema.safeParse(decryptedData);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.errors.map(e => e.message).join(", ");
      await logWarning("POST /api/auth/login", `Validation failed: ${errorMsg}`);
      return NextResponse.json({ message: "Invalid request data format: " + errorMsg }, { status: 400 });
    }

    const {
      username,
      password,
      email,
      authType = "domain",
    } = decryptedData || {};

    const trimmedUsername = typeof username === "string" ? username.trim() : "";
    const trimmedPassword = typeof password === "string" ? password.trim() : "";
    const trimmedEmail = typeof email === "string" ? email.trim() : "";

    let loginResult;

    const license = await getStoredLicense();
    const activeModules = await getActiveModuleIds(license);

    // Block login only if NO active modules (all expired)
    if (!license) {
      await logWarning(
        "POST /api/auth/login",
        "Login blocked: license file missing.",
        { hasLicense: false },
      );
      return NextResponse.json(
        { message: "License not found. Please contact your administrator." },
        { status: 403 },
      );
    }

    if (activeModules.length === 0) {
      await logWarning(
        "POST /api/auth/login",
        "Login blocked: license expired.",
        { activeModules },
      );
      return NextResponse.json(
        { message: "Your license has expired." },
        { status: 403 },
      );
    }
    // if (!license || activeModules.length === 0) {
    //   await logWarning(
    //     "POST /api/auth/login",
    //     "Login blocked: license expired or missing.",
    //     {
    //       hasLicense: !!license,
    //       activeModules,
    //     },
    //   );
    //   return NextResponse.json(
    //     { message: "Your license has expired." },
    //     { status: 403 },
    //   );
    // }

    if (authType === "sso") {
      if (isInvalid(trimmedEmail)) {
        await logWarning(
          "POST /api/auth/login",
          "SSO login attempt with empty email.",
          {
            authType,
          },
        );
        return NextResponse.json(
          { message: "Email cannot be empty for SSO login." },
          { status: 400 },
        );
      }

      if (email !== trimmedEmail) {
        await logWarning(
          "POST /api/auth/login",
          "SSO login attempt with spaces in email.",
          {
            authType,
          },
        );
        return NextResponse.json(
          { message: "Email contains invalid spaces." },
          { status: 400 },
        );
      }

      loginResult = await getUserSsoLogin(trimmedEmail);
    } else {
      if (isInvalid(trimmedUsername) || isInvalid(trimmedPassword)) {
        await logWarning(
          "POST /api/auth/login",
          "Login attempt with empty username or password.",
          {
            authType,
          },
        );
        return NextResponse.json(
          { message: "LoginId or password cannot be empty." },
          { status: 400 },
        );
      }

      if (username !== trimmedUsername) {
        await logWarning(
          "POST /api/auth/login",
          "Login attempt with spaces in username.",
          {
            authType,
            username: trimmedUsername,
          },
        );
        return NextResponse.json(
          { message: "Username or Email contains invalid spaces." },
          { status: 400 },
        );
      }

      loginResult = await getUserLogin(trimmedUsername, trimmedPassword);
    }

    // === Handle SP output messages ===
    const msg = loginResult?.output?.outputmsg;

    if (msg === LOGIN_MESSAGES.INVALID_CREDENTIALS) {
      await logWarning("POST /api/auth/login", "Invalid credentials attempt.", {
        authType,
        username: trimmedUsername || trimmedEmail,
      });
      return NextResponse.json({ message: msg }, { status: 401 });
    }

    if (msg === LOGIN_MESSAGES.USER_NOT_FOUND) {
      await logWarning(
        "POST /api/auth/login",
        "User not found or inactive in system.",
        {
          authType,
          username: trimmedUsername || trimmedEmail,
        },
      );
      return NextResponse.json({ message: msg }, { status: 404 });
    }

    if (msg === LOGIN_MESSAGES.ACCOUNT_NOT_EXISTS) {
      await logWarning("POST /api/auth/login", "Account does not exist.", {
        authType,
        username: trimmedUsername || trimmedEmail,
      });
      return NextResponse.json({ message: msg }, { status: 403 });
    }

    if (msg === LOGIN_MESSAGES.SSO_EMAIL_NOT_FOUND) {
      await logWarning(
        "POST /api/auth/login",
        "SSO email not found in system.",
        {
          authType,
          email: trimmedEmail,
        },
      );
      return NextResponse.json({ message: msg }, { status: 404 });
    }

    if (loginResult?.recordsets?.length > 0) {
      const userArray = await setUsersLoginModel(
        loginResult.recordset,
        loginResult.recordsets,
      );

      if (Array.isArray(userArray) && userArray.length > 0) {
        const user = userArray[0];
        const userId = user.userId;

        await logAudit({
          userId: user.userId,
          userName: user.userFullName,
          actionType: "LOGIN",
          description: "User logged into system",
        });

        await expireOtherSessions(userId);
        const userLoginToken = await generateJWTToken(user);
        await createNewSession(userId, userLoginToken, request);

        // ✅ Log successful login
        await logSuccess(
          "POST /api/auth/login",
          "User logged in successfully.",
          {
            userId: user.userId,
            authType,
          },
        );

        const response = NextResponse.json({
          message: loginResult.output.outputmsg,
          token: userLoginToken,
          user: {
            userId: user.userId,
            userFullName: user.userFullName,
            userRoles: user.userRoles,
            email: user.email,
            organization: user.organization,
            licensedModules:
              (await getActiveModuleIds(await getStoredLicense())) || [],
          },
        });

        const isProduction = process.env.NODE_ENV === "production";
        const isHttps = request.url.startsWith("https");

        response.cookies.set("sessionToken", userLoginToken, {
          httpOnly: true,
          secure: isProduction && isHttps,
          path: "/",
          sameSite: "lax",
          maxAge: 60 * 60 * 60 * 1,
        });

        return response;
      }
    }

    // Fallback — SP returned 200 but no recordsets
    await logError(
      "POST /api/auth/login",
      new Error(msg || "Login failed: SP returned no recordsets."),
      { authType, username: trimmedUsername || trimmedEmail },
    );
    return NextResponse.json(
      {
        message: msg || "Login failed. Please try again.",
      },
      { status: 500 },
    );
  } catch (error) {
    await logError("POST /api/auth/login", error);
    console.error("Error during login process:", error);
    return NextResponse.json(
      {
        message:
          error?.message === "Unexpected end of JSON input"
            ? "Invalid login payload."
            : "An internal server error occurred.",
      },
      { status: 500 },
    );
  }
}

async function createNewSession(userId, token, req) {
  try {
    const expiryTimestamp = new Date();
    expiryTimestamp.setDate(expiryTimestamp.getDate() + 2);

    const userAgent = req.headers.get("user-agent") || "unknown";
    const inputParams = {
      userId,
      sessionToken: token,
      loginTimestamp: new Date().toISOString(),
      expiryTimestamp: expiryTimestamp.toISOString(),
      userAgent,
    };

    await executeStoredProcedure("usp_CreateUserSession", inputParams, {});
  } catch (error) {
    await logError("createNewSession", error, { userId });
    console.error("Error creating new session:", error);
  }
}

async function expireOtherSessions(userId) {
  try {
    const currentTimestamp = new Date().toISOString();
    const inputParams = {
      userId,
      expiryTimestamp: currentTimestamp,
    };

    await executeStoredProcedure("usp_ExpireUserSessions", inputParams, {});
  } catch (error) {
    await logError("expireOtherSessions", error, { userId });
    console.error("Error expiring other sessions:", error);
  }
}

async function getUserLogin(username, password) {
  try {
    const inputParams = { username, password };
    const result = await executeStoredProcedure(
      "usp_UserLogin",
      inputParams,
      outputmsgParams,
    );
    return result;
  } catch (error) {
    await logError("getUserLogin", error, { username });
    console.error("Error getting user login:", error);
  }
}

async function getUserSsoLogin(email) {
  try {
    const inputParams = { email };
    const result = await executeStoredProcedure(
      "usp_UserLogin_SSO",
      inputParams,
      outputmsgParams,
    );
    return result;
  } catch (error) {
    await logError("getUserSsoLogin", error, { email });
    console.error("Error getting SSO user login:", error);
  }
}

async function generateJWTToken(userDetails) {
  try {
    const user = userDetails;
    const license = await getStoredLicense();
    const payload = {
      userId: user.userId,
      loginId: user.loginId,
      email: user.email,
      userFullName: user.userFullName,
      userRole: user.userRoles,
      phone: user.phone,
      licensedModules: (await getActiveModuleIds(license)) || [],
      licenseExpiry: license?.expiryDate || null,
    };
    const secretkey = process.env.API_SECRET_KEY;
    const options = { expiresIn: "1d" };

    const token = jwt.sign(payload, secretkey, options);
    return token;
  } catch (error) {
    await logError("generateJWTToken", error, { userId: userDetails?.userId });
    console.error("Error generating JWT Token:", error);
  }
}
