import { NextResponse } from 'next/server';
import { isInvalid } from '@/lib/generic';
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams
} from '@/lib/sql.js';

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const loggedInUserIdHeader = request.headers.get('loggedInUserId');
    const loggedInUserId = parseInt(loggedInUserIdHeader?.trim() || '');

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: 'Invalid or missing loggedInUserId in headers.' },
        { status: 400 }
      );
    }
    const result = await executeStoredProcedure(
      'usp_CreatorWiseFormDistribution',
      { currentUserId: loggedInUserId },
      outputmsgWithStatusCodeParams
    );

    const creatorWiseData = result?.recordsets?.[0] ?? [];

    return new NextResponse(
      JSON.stringify({
        message: result.output.outputmsg,
        data: creatorWiseData
      }),
      {
        status: result.output.statuscode,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store', // Change to 'public, max-age=60' if cacheable
          'Keep-Alive': 'timeout=5, max=1000',
        },
      }
    );
  } catch (error) {
    console.error('[API ERROR] creator-wise form:', error);

    return NextResponse.json(
      {
        message: 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined, // secure error
      },
      { status: 500 }
    );
  }
}
