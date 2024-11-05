import { type NextRequest, NextResponse, userAgent } from 'next/server';
import { handleDeployment } from './lib/services/deployment';

declare const console: Console;

export async function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  console.log(
    'req headers',
    JSON.stringify(Array.from(headers.entries()), null, 2)
  );
  const { device, isBot } = userAgent(request);
  const isMobile = device.type === 'mobile' ? '1' : '0';
  const authToken = request.cookies.get('authToken');
  const uuidCookie = request.cookies.get('ser_uuid');
  const url = new URL(request.url);
  const cpn = url.searchParams.get('cpn');
  const lang = 'en';
  const uuid = Date.now().toString();

  if (!request.headers.get('x-deployment-override')) {
    headers.set(
      'nextLocation',
      JSON.stringify({
        ip: headers.get('x-real-ip') || '',
        country: headers.get('x-vercel-ip-country') || '',
        region: headers.get('x-vercel-ip-country-region') || '',
        city: headers.get('x-vercel-ip-city') || '',
        latitude: headers.get('x-vercel-ip-latitude') || '',
        longitude: headers.get('x-vercel-ip-longitude') || '',
      })
    );
  }

  headers.set('ser_uuid', uuid);
  headers.set('pathname', url.pathname);
  headers.set('params', url.searchParams as unknown as string);
  headers.set('isMobile', isMobile);
  headers.set('isBot', isBot ? 'true' : 'false');

  try {
    let token: string | undefined = undefined;

    if (authToken) {
      token = authToken.value.replace(/ /g, '+');
    } else {
      try {
        headers.set('authToken', btoa(Date.now().toString()));
        headers.set('lang', lang);
      } catch (e) {
        console.error(`error in /auth/token endpoint: ${e}`, 'middleware');
      }
    }

    const response = NextResponse.next({ request: { headers } });
    response.cookies.set('debug-uuid', uuid, { maxAge: 3000 });

    if (!authToken && token) {
      response.cookies.set('authToken', token, { maxAge: 3000 });
    }

    if (!uuidCookie) {
      response.cookies.set('ser_uuid', uuid, { maxAge: 3000 });
    }

    if (cpn) response.cookies.set('cpn', cpn);

    response.headers.append(
      'Access-Control-Allow-Origin',
      'https://00301507-blue-green-env-test.preview.vercel-support.app'
    );

    return await handleDeployment(
      request,
      response,
      headers,
      uuid,
      'nectarsleep-production-rc-configuration',
      'rc-00301507.vercel-support.app'
    );
  } catch (e) {
    console.error(`middleware error: ${e}`, 'middleware');
  }
}

export const config = {
  runtime: 'experimental-edge',
  unstable_allowDynamic: [
    '**/node_modules/lodash/*',
    '**/node_modules/lodash.throttle/*',
    '**/node_modules/@mui/utils/esm/**',
  ],
  matcher: [
    {
      // source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
    },
  ],
};
