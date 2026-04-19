export function buildCorsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function getHeaderValue(headers: unknown, name: string) {
  if (!headers) return null;

  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }

  const record = headers as Record<string, string | string[] | undefined>;
  const value = record[name.toLowerCase()] ?? record[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}

function isWebRequest(request: unknown): request is Request {
  return (
    typeof request === 'object' &&
    request !== null &&
    typeof (request as Request).text === 'function' &&
    typeof (request as Request).headers?.get === 'function'
  );
}

function isAsyncIterableBody(value: unknown): value is AsyncIterable<Uint8Array | string> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

async function readStreamBody(stream: AsyncIterable<Uint8Array | string>) {
  const chunks: Uint8Array[] = [];

  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(new TextEncoder().encode(chunk));
    } else {
      chunks.push(chunk);
    }
  }

  if (chunks.length === 0) return '';

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

async function readRequestBody(request: Request | { body?: unknown }) {
  if (isWebRequest(request)) {
    return await request.text();
  }

  if (isAsyncIterableBody(request)) {
    return readStreamBody(request);
  }

  const body = request.body;
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) return body.toString('utf8');
  if (isAsyncIterableBody(body)) return readStreamBody(body);

  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function sendNodeResponse(
  response: {
    status: (code: number) => { send: (body: string) => void };
    setHeader: (name: string, value: string) => void;
  },
  status: number,
  headers: Record<string, string>,
  body: string,
) {
  Object.entries(headers).forEach(([key, value]) => response.setHeader(key, value));
  response.status(status).send(body);
}

export async function proxyJSONRequest(
  request: Request | { method?: string; headers?: unknown; body?: unknown },
  response:
    | {
        status: (code: number) => { send: (body: string) => void };
        setHeader: (name: string, value: string) => void;
      }
    | undefined,
  targetURL: string,
  bearerToken: string,
  missingTokenMessage: string,
  transformRequestBody?: (body: string | undefined) => string | undefined,
) {
  const origin = getHeaderValue(request.headers, 'origin');
  const corsHeaders = buildCorsHeaders(origin);
  const method = request.method || 'GET';

  if (method === 'OPTIONS') {
    if (response) {
      sendNodeResponse(response, 204, corsHeaders, '');
      return;
    }

    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (!bearerToken) {
    const payload = JSON.stringify({ error: missingTokenMessage });
    const headers = {
      ...corsHeaders,
      'Content-Type': 'application/json',
    };

    if (response) {
      sendNodeResponse(response, 500, headers, payload);
      return;
    }

    return new Response(payload, {
      status: 500,
      headers,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const contentType = getHeaderValue(request.headers, 'content-type') || 'application/json';
    const requestBody = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBody(request);
    const transformedBody = transformRequestBody ? transformRequestBody(requestBody) : requestBody;

    const upstreamResponse = await fetch(targetURL, {
      method,
      headers: {
        'Content-Type': contentType,
        Authorization: `Bearer ${bearerToken}`,
      },
      body: transformedBody,
      signal: controller.signal,
    });

    const responseText = await upstreamResponse.text();
    const headers = {
      ...corsHeaders,
      'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json',
    };

    if (response) {
      sendNodeResponse(response, upstreamResponse.status, headers, responseText);
      return;
    }

    return new Response(responseText, {
      status: upstreamResponse.status,
      headers,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Upstream AI request timed out. Please try again in a moment.'
        : error instanceof Error
          ? error.message
          : 'Upstream AI request failed.';
    const status = error instanceof Error && error.name === 'AbortError' ? 504 : 500;

    const payload = JSON.stringify({ error: message });
    const headers = {
      ...corsHeaders,
      'Content-Type': 'application/json',
    };

    if (response) {
      sendNodeResponse(response, status, headers, payload);
      return;
    }

    return new Response(payload, {
      status,
      headers,
    });
  } finally {
    clearTimeout(timeout);
  }
}
