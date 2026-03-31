const MOONSHOT_ORIGIN = 'https://api.moonshot.cn';

function buildCorsHeaders(origin: string | undefined) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function extractForwardPath(path: string) {
  const marker = '/.netlify/functions/moonshot/';
  const markerIndex = path.indexOf(marker);

  if (markerIndex === -1) {
    return '/v1/chat/completions';
  }

  const suffix = path.slice(markerIndex + marker.length);
  return `/${suffix}`.replace(/\/+/g, '/');
}

export default async (request: Request) => {
  const origin = request.headers.get('origin') || undefined;
  const corsHeaders = buildCorsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  const forwardPath = extractForwardPath(new URL(request.url).pathname);
  const targetURL = `${MOONSHOT_ORIGIN}${forwardPath}`;

  const response = await fetch(targetURL, {
    method: request.method,
    headers: {
      'Content-Type': request.headers.get('content-type') || 'application/json',
      Authorization: request.headers.get('authorization') || '',
    },
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
  });

  const responseText = await response.text();

  return new Response(responseText, {
    status: response.status,
    headers: {
      ...corsHeaders,
      'Content-Type': response.headers.get('content-type') || 'application/json',
    },
  });
};
