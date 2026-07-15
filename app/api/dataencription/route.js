import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

export async function POST(request) {
  const { data } = await request.json();
  const saltRounds = 10;
  const hashPassword = await bcrypt.hash(data, saltRounds);
  return NextResponse.json({
    success: true,
    salt: saltRounds,
    hashData: hashPassword,
  });
}
