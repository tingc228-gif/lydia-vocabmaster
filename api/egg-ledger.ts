import {
  createNotionPageInDataSource,
  getEggLedgerDataSourceId,
  getNotionToken,
  queryNotionDataSourceById,
} from './_lib/notion';
import { buildCorsHeaders } from './_lib/proxy';

export const config = {
  runtime: 'edge',
};

interface EggLedgerPayload {
  amount?: number;
  totalAfter?: number;
  label?: string;
  eventType?: 'Earn' | 'Reset' | 'Adjust';
  note?: string;
  sessionId?: string;
  occurredAt?: string;
}

interface EggLedgerEntry {
  amount: number;
  totalAfter: number;
  eventType: 'Earn' | 'Reset' | 'Adjust';
  module: string;
  eventDate: string;
}

function richText(content: string) {
  const value = content.trim();
  return value
    ? [
        {
          type: 'text',
          text: {
            content: value,
          },
        },
      ]
    : [];
}

function buildEventTitle(payload: Required<Pick<EggLedgerPayload, 'amount' | 'label' | 'eventType'>>) {
  const amountLabel = payload.amount > 0 ? `+${payload.amount}` : String(payload.amount);
  return `${payload.eventType} ${amountLabel} · ${payload.label}`;
}

function readPlainText(items: Array<{ plain_text?: string }> | undefined) {
  return (items || []).map((item) => item.plain_text || '').join('').trim();
}

function parseNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseLedgerEntry(page: { properties?: Record<string, any> }): EggLedgerEntry | null {
  const properties = page.properties || {};
  const eventType = properties['Event Type']?.select?.name;
  const eventDate = properties['Event Date']?.date?.start || '';

  if (!eventType || !eventDate) {
    return null;
  }

  return {
    amount: parseNumber(properties.Amount?.number),
    totalAfter: parseNumber(properties['Total After']?.number),
    eventType,
    module: readPlainText(properties.Module?.rich_text),
    eventDate,
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

  const dataSourceId = getEggLedgerDataSourceId();
  if (!dataSourceId) {
    return new Response(JSON.stringify({ error: 'Missing NOTION_EGG_LEDGER_DATA_SOURCE_ID environment variable.' }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  try {
    if (request.method === 'GET') {
      const response = await queryNotionDataSourceById(dataSourceId, {
        page_size: 100,
        sorts: [
          {
            property: 'Event Date',
            direction: 'descending',
          },
        ],
      });

      const entries = (response.results || [])
        .map((page) => parseLedgerEntry(page))
        .filter((entry): entry is EggLedgerEntry => Boolean(entry));

      const latestResetIndex = entries.findIndex((entry) => entry.eventType === 'Reset');
      const entriesSinceReset = latestResetIndex >= 0 ? entries.slice(0, latestResetIndex + 1) : entries;
      const latestEntry = entriesSinceReset[0] || null;
      const latestReset = latestResetIndex >= 0 ? entries[latestResetIndex] : null;

      const currentTotal = latestEntry
        ? latestEntry.totalAfter
        : 0;

      return new Response(JSON.stringify({
        currentTotal,
        latestEventAt: latestEntry?.eventDate || '',
        latestResetAt: latestReset?.eventDate || '',
        eventCountSinceReset: entriesSinceReset.length,
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    const body = (await request.json()) as EggLedgerPayload;
    const amount = Number(body.amount ?? 0);
    const totalAfter = Number(body.totalAfter ?? 0);
    const label = String(body.label || 'Unknown module').trim();
    const eventType = body.eventType === 'Reset' || body.eventType === 'Adjust' ? body.eventType : 'Earn';
    const note = String(body.note || '').trim();
    const sessionId = String(body.sessionId || '').trim();
    const occurredAt = String(body.occurredAt || new Date().toISOString()).trim();

    await createNotionPageInDataSource(dataSourceId, {
      Event: {
        title: richText(buildEventTitle({ amount, label, eventType })),
      },
      Amount: {
        number: amount,
      },
      'Total After': {
        number: totalAfter,
      },
      Module: {
        rich_text: richText(label),
      },
      'Event Type': {
        select: {
          name: eventType,
        },
      },
      'Session ID': {
        rich_text: richText(sessionId),
      },
      'Event Date': {
        date: {
          start: occurredAt,
        },
      },
      Note: {
        rich_text: richText(note),
      },
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
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
