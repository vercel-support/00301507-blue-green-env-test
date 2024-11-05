import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const reqHeaders = request.headers;
  if (!reqHeaders.has('x-initial-route')) {
    reqHeaders.set('x-initial-route', 'a');
    const res = await fetch(`https://${process.env.VERCEL_URL}/api/b`, {
      headers: reqHeaders,
      next: {
        revalidate: false,
      },
    });
    const resHeaders = Array.from(res.headers.entries());
    return NextResponse.json({
      reqHeaders: Array.from(reqHeaders.entries()),
      resHeaders,
    });
  }
  return NextResponse.json({
    reqHeaders: Array.from(reqHeaders.entries()),
  });
}
