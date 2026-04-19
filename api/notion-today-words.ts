import {
  FIVE_STARS,
  getNotionDataSourceId,
  getNotionToken,
  getTodayInSingapore,
  parseWordPage,
  PROPERTY_LEVEL,
  PROPERTY_NEXT_REVIEW,
  queryNotionDataSource,
} from './_lib/notion';
import { buildCorsHeaders } from './_lib/proxy';

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request) {
  const origin = request.headers.get('origin');
  const corsHeaders = buildCorsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (!getNotionToken()) {
    return new Response(JSON.stringify({ error: 'Missing NOTION_TOKEN environment variable.' }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  if (!getNotionDataSourceId()) {
    return new Response(JSON.stringify({ error: 'Missing NOTION_DATA_SOURCE_ID environment variable.' }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  try {
    const sortedResponse = await queryNotionDataSource({
      page_size: 20,
      filter: {
        property: PROPERTY_LEVEL,
        select: {
          does_not_equal: FIVE_STARS,
        },
      },
      sorts: [
        {
          property: PROPERTY_NEXT_REVIEW,
          direction: 'ascending',
        },
      ],
    });

    const items = (sortedResponse.results || [])
      .map((page) => parseWordPage(page))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .slice(0, 20);

    return new Response(
      JSON.stringify({
        date: getTodayInSingapore(),
        count: items.length,
        items,
        wordsText: items.map((item) => `${item.word} — ${item.meaning || ''}`.trim()).join('\n'),
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  }
}
