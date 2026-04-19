import { proxyJSONRequest } from '../../../_lib/proxy.js';

export const config = {
  runtime: 'nodejs',
};

export default async function handler(request: Request, response?: any) {
  const token = process.env.MINIMAX_API_KEY || '';

  return proxyJSONRequest(
    request,
    response,
    'https://api.minimaxi.com/v1/chat/completions',
    token,
    'Missing MINIMAX_API_KEY environment variable.',
  );
}
