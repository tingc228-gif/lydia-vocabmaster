import {
  getNotionToken,
  getTodayInSingapore,
  nextLevel,
  PROPERTY_LAST_REVIEW,
  PROPERTY_LEVEL,
  STAR_LEVELS,
  updateNotionPage,
} from './_lib/notion';
import { buildCorsHeaders } from './_lib/proxy';

export const config = {
  runtime: 'edge',
};

interface ReviewItem {
  id: string;
  word: string;
  level: string;
}

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

  try {
    const body = (await request.json()) as { items?: ReviewItem[]; incorrectWords?: string[] };
    const items = Array.isArray(body.items) ? body.items.filter((item) => item?.id && item?.word) : [];
    const incorrectWords = new Set(
      (Array.isArray(body.incorrectWords) ? body.incorrectWords : [])
        .map((word) => String(word || '').trim().toLowerCase())
        .filter(Boolean),
    );

    if (items.length === 0) {
      return new Response(JSON.stringify({ error: 'No Notion review items were provided.' }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    const today = getTodayInSingapore();
    let leveledUpCount = 0;

    for (const item of items) {
      const shouldLevelUp = !incorrectWords.has(item.word.trim().toLowerCase()) && item.level !== STAR_LEVELS[STAR_LEVELS.length - 1];
      const properties: Record<string, unknown> = {
        [PROPERTY_LAST_REVIEW]: {
          date: {
            start: today,
          },
        },
      };

      if (shouldLevelUp) {
        properties[PROPERTY_LEVEL] = {
          select: {
            name: nextLevel(item.level),
          },
        };
        leveledUpCount += 1;
      }

      await updateNotionPage(item.id, properties);
    }

    return new Response(
      JSON.stringify({
        updatedCount: items.length,
        leveledUpCount,
        date: today,
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
