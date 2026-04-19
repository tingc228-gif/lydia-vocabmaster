import { proxyJSONRequest } from '../../../_lib/proxy.js';

export const config = {
  runtime: 'nodejs',
};

export default async function handler(request: Request, response?: any) {
  const token = process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || '';

  return proxyJSONRequest(
    request,
    response,
    'https://api.moonshot.cn/v1/chat/completions',
    token,
    'Missing MOONSHOT_API_KEY or KIMI_API_KEY environment variable.',
    (body) => {
      if (!body) return body;

      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const nextBody = {
          ...parsed,
          model: 'kimi-k2.5',
          thinking: {
            type: 'disabled',
          },
        };
        return JSON.stringify(nextBody);
      } catch {
        return body;
      }
    },
  );
}
