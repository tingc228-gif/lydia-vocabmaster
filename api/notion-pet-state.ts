import {
  createNotionPageInDataSource,
  getNotionPetStateDataSourceId,
  getNotionToken,
  getTodayInSingapore,
  parsePetStatePage,
  PET_PROPERTY_CARE_ROUND,
  PET_PROPERTY_FOOD,
  PET_PROPERTY_GROWTH,
  PET_PROPERTY_JOY,
  PET_PROPERTY_LAST_SYNCED,
  PET_PROPERTY_NAME,
  queryNotionDataSourceById,
  updateNotionPage,
} from './_lib/notion';
import { buildCorsHeaders } from './_lib/proxy';

export const config = {
  runtime: 'edge',
};

const PRIMARY_PET_STATE_NAME = 'Primary Pet State';

function buildPetProperties({
  foodPercent,
  joyPercent,
  growthPercent,
  careRound,
}: {
  foodPercent: number;
  joyPercent: number;
  growthPercent: number;
  careRound: number;
}) {
  return {
    [PET_PROPERTY_NAME]: {
      title: [{ text: { content: PRIMARY_PET_STATE_NAME } }],
    },
    [PET_PROPERTY_FOOD]: {
      number: foodPercent,
    },
    [PET_PROPERTY_JOY]: {
      number: joyPercent,
    },
    [PET_PROPERTY_GROWTH]: {
      number: growthPercent,
    },
    [PET_PROPERTY_CARE_ROUND]: {
      number: Math.max(1, careRound),
    },
    [PET_PROPERTY_LAST_SYNCED]: {
      date: {
        start: getTodayInSingapore(),
      },
    },
  };
}

async function findOrCreatePrimaryPetStatePage(dataSourceId: string) {
  const response = await queryNotionDataSourceById(dataSourceId, {
    page_size: 10,
    filter: {
      property: PET_PROPERTY_NAME,
      title: {
        equals: PRIMARY_PET_STATE_NAME,
      },
    },
  });

  const existing = (response.results || [])[0];
  if (existing) {
    return parsePetStatePage(existing);
  }

  const created = await createNotionPageInDataSource(
    dataSourceId,
    buildPetProperties({
      foodPercent: 0,
      joyPercent: 0,
      growthPercent: 0,
      careRound: 1,
    }),
  );

  return {
    id: created.id || '',
    name: PRIMARY_PET_STATE_NAME,
    foodPercent: 0,
    joyPercent: 0,
    growthPercent: 0,
    careRound: 1,
    lastSynced: getTodayInSingapore(),
  };
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

  const petDataSourceId = getNotionPetStateDataSourceId();
  if (!petDataSourceId) {
    return new Response(JSON.stringify({ error: 'Missing NOTION_PET_STATE_DATA_SOURCE_ID environment variable.' }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  try {
    if (request.method === 'GET') {
      const petState = await findOrCreatePrimaryPetStatePage(petDataSourceId);

      return new Response(JSON.stringify(petState), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    if (request.method === 'POST') {
      const body = (await request.json()) as {
        id?: string;
        foodPercent?: number;
        joyPercent?: number;
        growthPercent?: number;
        careRound?: number;
      };

      const current = body.id
        ? {
            id: body.id,
          }
        : await findOrCreatePrimaryPetStatePage(petDataSourceId);

      await updateNotionPage(
        current.id,
        buildPetProperties({
          foodPercent: Number(body.foodPercent || 0),
          joyPercent: Number(body.joyPercent || 0),
          growthPercent: Number(body.growthPercent || 0),
          careRound: Math.max(1, Number(body.careRound || 1)),
        }),
      );

      return new Response(
        JSON.stringify({
          id: current.id,
          name: PRIMARY_PET_STATE_NAME,
          foodPercent: Number(body.foodPercent || 0),
          joyPercent: Number(body.joyPercent || 0),
          growthPercent: Number(body.growthPercent || 0),
          careRound: Math.max(1, Number(body.careRound || 1)),
          lastSynced: getTodayInSingapore(),
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
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
