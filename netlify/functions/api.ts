import serverless from 'serverless-http';
import { createExpressApp } from '../../server/app';

const lambdaHandler = serverless(createExpressApp());

type LambdaResult = {
  statusCode?: number;
  headers?: Record<string, string | number | boolean>;
  multiValueHeaders?: Record<string, string[]>;
  body?: string;
  isBase64Encoded?: boolean;
};

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const headers: Record<string, string> = {};
  const multiValueHeaders: Record<string, string[]> = {};

  request.headers.forEach((value, key) => {
    headers[key] = value;
    multiValueHeaders[key] = [value];
  });

  const queryStringParameters: Record<string, string> = {};
  const multiValueQueryStringParameters: Record<string, string[]> = {};

  url.searchParams.forEach((value, key) => {
    queryStringParameters[key] = value;
    (multiValueQueryStringParameters[key] ??= []).push(value);
  });

  const bytes =
    request.method === 'GET' || request.method === 'HEAD'
      ? null
      : Buffer.from(await request.arrayBuffer());

  const event = {
    httpMethod: request.method,
    path: url.pathname,
    headers,
    multiValueHeaders,
    queryStringParameters,
    multiValueQueryStringParameters,
    body: bytes ? bytes.toString('base64') : null,
    isBase64Encoded: bytes !== null,
    requestContext: {
      identity: {
        sourceIp:
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
      }
    }
  };

  const result = (await lambdaHandler(
    event as any,
    {} as any
  )) as LambdaResult;

  const responseHeaders = new Headers();

  for (const [key, value] of Object.entries(result.headers ?? {})) {
    if (key.toLowerCase() !== 'set-cookie') {
      responseHeaders.set(key, String(value));
    }
  }

  const cookies = Object.entries(result.multiValueHeaders ?? {})
    .filter(([key]) => key.toLowerCase() === 'set-cookie')
    .flatMap(([, values]) => values);

  if (cookies.length) {
    for (const cookie of cookies) {
      responseHeaders.append('set-cookie', cookie);
    }
  } else {
    for (const [key, value] of Object.entries(result.headers ?? {})) {
      if (key.toLowerCase() === 'set-cookie') {
        responseHeaders.append('set-cookie', String(value));
      }
    }
  }

  const status = result.statusCode ?? 200;
  const noBody = [204, 205, 304].includes(status);

  const body = noBody
    ? null
    : result.isBase64Encoded
      ? new Uint8Array(Buffer.from(result.body ?? '', 'base64'))
      : result.body ?? null;

  return new Response(body, {
    status,
    headers: responseHeaders
  });
}
