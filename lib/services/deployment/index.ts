import type { NextRequest, NextResponse } from 'next/server';

const MAX_AGE = 60 * 60 * 24; // 24 hours
export const MAX_AGE_TOKEN = 2592000; // 30 days

/**
 * Formats a deployment URL by extracting the hostname if the URL starts with "http".
 * If the URL does not start with "http", it returns the original URL.
 *
 * @param {string} deploymentUrl - The deployment URL to format.
 * @returns {string} - The formatted deployment URL, which is the hostname if the URL starts with "http", otherwise the original URL.
 */
function formatDeploymentUrl(deploymentUrl: string): string {
  if (/^http/.test(deploymentUrl || '')) {
    return new URL(deploymentUrl || '').hostname;
  }
  return deploymentUrl;
}

/**
 * Fetches the HTML document from the selected deployment domain and returns it to the user.
 *
 * @param {NextRequest} req - The incoming request object.
 * @param {string} domain - The deployment domain to fetch the document from.
 * @param {Headers} headers - The headers to include in the fetch request.
 * @param {string} uuid - The unique identifier for the user.
 * @returns {Promise<Response>} - The response from the fetch request.
 */
async function getNextResponse(
  req: NextRequest,
  domain: string,
  headers: Headers,
  uuid: string
): Promise<Response> {
  // make sure always to use the hostname only
  const formattedDomain = formatDeploymentUrl(domain);

  // Fetch the HTML document from the selected deployment domain and return it to the user.
  const url = new URL(req.url);
  url.hostname = formattedDomain;

  headers.set('x-deployment-override', formattedDomain);

  const deployment = await fetch(url, {
    headers,
    redirect: 'manual',
  });

  console.log(
    '[DEPLOYMENT] Cookie List',
    url.href,
    deployment.headers.getSetCookie(),
    uuid
  );

  const { status } = deployment;

  if (status >= 400) {
    console.error(
      '[DEPLOYMENT] deployment response status code',
      { url: url.href, status },
      uuid
    );
  }

  return deployment;
}

/**
 * Selects the environment based on the blue-green configuration.
 *
 * @param {BlueGreenConfig} config - The configuration object containing traffic percentage.
 * @returns {"rc" | "production"} - The environment ("rc" or "production").
 */
function selectBlueGreenDeployment(config: {
  trafficRcPercent: number;
}): 'rc' | 'production' {
  return Math.random() * 100 < config.trafficRcPercent ? 'rc' : 'production';
}

/**
 * Fetches the HTML document from the selected deployment domain and sets the release\_candidate cookie.
 *
 * @param {NextRequest} req - The incoming request object.
 * @param headers - The headers to include in the fetch request.
 * @param uuid - The unique identifier for the user.
 * @param rcDomain - The RC environment domain.
 * @returns {Promise<Response>} - The response from the fetch request with the release\_candidate cookie set.
 */
async function fetchRCDeployment(
  req: NextRequest,
  headers: Headers,
  uuid: string,
  rcDomain: string,
  _response: NextResponse
): Promise<Response> {
  // Fetches the HTML document from the selected deployment domain
  const response = await getNextResponse(req, rcDomain, headers, uuid);

  for (const value of [
    ..._response.headers.getSetCookie(),
    ['release_candidate=true'],
  ]) {
    response.headers.append('set-cookie', value.toString());
  }

  return response;
}

/**
 * Handles the deployment process by determining the appropriate deployment domain and setting the necessary cookies.
 *
 * @param {NextRequest} request - The incoming request object.
 * @param {NextResponse} response - The response object to set the cookies on.
 * @param headers - The headers to include in the fetch request.
 * @param uuid - The unique identifier for the user.
 * @param {string} config - The configuration string to fetch the blue-green configuration.
 * @param {string} rcDomain - The RC environment domain.
 * @returns {Promise<NextResponse>} - The response object after processing the deployment logic.
 */
export const handleDeployment = async (
  request: NextRequest,
  response: NextResponse,
  headers: Headers,
  uuid: string,
  config: string,
  rcDomain: string
): Promise<Response> => {
  const url = new URL(request.url);
  const userAgent = headers.get('user-agent') || '';

  /*
   * STEP 1: Skip blue-green deployment.
   * We don't want to run blue-green during development.
   * */
  const isDocumentRequest = request.headers.has('sec-fetch-dest')
    ? request.headers.get('sec-fetch-dest') === 'document'
    : request.headers.get('accept')?.includes('text/html');

  const isVercelUserAgent = /vercel/i.test(userAgent);
  const shouldSkipBlueGreenDeployment =
    false ||
    request.method !== 'GET' ||
    !isDocumentRequest ||
    isVercelUserAgent ||
    false;

  if (shouldSkipBlueGreenDeployment) {
    console.info('[DEPLOYMENT] Skipping blue-green deployment.', uuid);

    console.log(
      -1,
      response.headers.entries().reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>)
    );
    return response;
  }

  if (request.cookies.get('release_candidate')?.value === 'false') {
    console.log(
      0,
      response.headers.entries().reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>)
    );
    return response;
  }

  /*
   * STEP 2: Skip if the middleware has already run.
   * This check needs to be done before the rest of the logic in order to add the cookie.
   * */
  if (request.headers.get('x-deployment-override')) {
    console.info(
      '[DEPLOYMENT] Skipping middleware as x-deployment-override header is present.',
      uuid
    );
    console.log(
      1,
      response.headers.entries().reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>)
    );

    return response;
  }

  /*
   * STEP 3: Check if the EDGE_CONFIG env variable & Config exists.
   * */
  // if (!getEdgeConfigUrl()) {
  //   console.warn(
  //     'EDGE_CONFIG env variable not set. Skipping prod-rc deployment configuration.'
  //   );
  //   return response;
  // }

  /*
   * Enforce the deployment to the release candidate environment, if user lands on /release-candidate.
   * */
  if (url.pathname === '/release-candidate') {
    console.info(
      '[DEPLOYMENT] Enforce the deployment to the release candidate environment.',
      uuid
    );
    return await fetchRCDeployment(request, headers, uuid, rcDomain, response);
  }

  /*
   * Serving release candidate environment, if release_candidate cookie is true.
   * */
  if (request.cookies.get('release_candidate')?.value === 'true') {
    console.info('[DEPLOYMENT] Serving release candidate environment', uuid);
    return await fetchRCDeployment(request, headers, uuid, rcDomain, response);
  }

  /*
   * Get the blue-green configuration from Edge Config.
   * */
  const productionRcConfig = {
    trafficRcPercent: 90,
  };

  /*
   * Check if the blue-green configuration from Edge Config exists.
   * */
  if (!productionRcConfig) {
    console.warn(
      'productionRcConfig does not exist. Skipping prod-rc deployment configuration.'
    );
    return response;
  }

  /*
   * STEP 4: Roll the dice to determine which deployment to use.
   * Serving deployment based on traffic distribution.
   * */
  const env = selectBlueGreenDeployment(productionRcConfig);

  if (env === 'production') {
    response.cookies.set('release_candidate', 'false', { maxAge: MAX_AGE });

    console.log(
      3,
      response.headers.entries().reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>)
    );
    return response;
  }

  console.info(
    '[DEPLOYMENT] Roll the dice to determine which deployment to use.',
    uuid
  );

  console.log(
    4,
    response.headers.entries().reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>)
  );

  return await fetchRCDeployment(request, headers, uuid, rcDomain, response);
};
