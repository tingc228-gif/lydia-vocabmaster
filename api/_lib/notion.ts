const NOTION_API_ORIGIN = 'https://api.notion.com';
const NOTION_VERSION = process.env.NOTION_API_VERSION || '2025-09-03';

export const PROPERTY_WORD = '单词';
export const PROPERTY_MEANING = '英文释义';
export const PROPERTY_LEVEL = '熟练度';
export const PROPERTY_NEXT_REVIEW = '下次复习时间';
export const PROPERTY_LAST_REVIEW = '上次复习时间';
export const PET_PROPERTY_NAME = 'Name';
export const PET_PROPERTY_FOOD = 'Food Percent';
export const PET_PROPERTY_JOY = 'Joy Percent';
export const PET_PROPERTY_GROWTH = 'Growth Percent';
export const PET_PROPERTY_CARE_ROUND = 'Care Round';
export const PET_PROPERTY_LAST_SYNCED = 'Last Synced';
export const FIVE_STARS = '🌟🌟🌟🌟🌟';
export const STAR_LEVELS = ['🌟', '🌟🌟', '🌟🌟🌟', '🌟🌟🌟🌟', '🌟🌟🌟🌟🌟'] as const;

export type NotionPropertyMap = Record<string, any>;

export function getNotionToken() {
  return process.env.NOTION_TOKEN || '';
}

export function getNotionDataSourceId() {
  return (process.env.NOTION_DATA_SOURCE_ID || '').trim();
}

export function getEggLedgerDataSourceId() {
  return (process.env.NOTION_EGG_LEDGER_DATA_SOURCE_ID || '').trim();
}

export function getNotionPetStateDataSourceId() {
  return (process.env.NOTION_PET_STATE_DATA_SOURCE_ID || '').trim();
}

export function getTodayInSingapore() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function readPlainText(items: Array<{ plain_text?: string }> | undefined) {
  return (items || []).map((item) => item.plain_text || '').join('').trim();
}

export function parseWordPage(page: { id?: string; properties?: NotionPropertyMap }) {
  const properties = page.properties || {};
  const word = readPlainText(properties[PROPERTY_WORD]?.title);
  const meaning = readPlainText(properties[PROPERTY_MEANING]?.rich_text);
  const level = properties[PROPERTY_LEVEL]?.select?.name || '';
  const nextReview = properties[PROPERTY_NEXT_REVIEW]?.formula?.date?.start || '';

  if (!word) return null;

  return {
    id: page.id || '',
    word,
    meaning,
    level,
    nextReview,
  };
}

export function parsePetStatePage(page: { id?: string; properties?: NotionPropertyMap }) {
  const properties = page.properties || {};
  const name = readPlainText(properties[PET_PROPERTY_NAME]?.title);

  return {
    id: page.id || '',
    name,
    foodPercent: Number(properties[PET_PROPERTY_FOOD]?.number || 0),
    joyPercent: Number(properties[PET_PROPERTY_JOY]?.number || 0),
    growthPercent: Number(properties[PET_PROPERTY_GROWTH]?.number || 0),
    careRound: Math.max(1, Number(properties[PET_PROPERTY_CARE_ROUND]?.number || 1)),
    lastSynced: properties[PET_PROPERTY_LAST_SYNCED]?.date?.start || '',
  };
}

export async function queryNotionDataSource(body: Record<string, unknown>) {
  return queryNotionDataSourceById(getNotionDataSourceId(), body);
}

export async function queryNotionDataSourceById(dataSourceId: string, body: Record<string, unknown>) {
  const response = await fetch(`${NOTION_API_ORIGIN}/v1/data_sources/${dataSourceId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getNotionToken()}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Notion API failed with status ${response.status}`);
  }

  return JSON.parse(text) as { results?: Array<{ id?: string; properties?: NotionPropertyMap }> };
}

export async function createNotionPageInDataSource(dataSourceId: string, properties: Record<string, unknown>) {
  const response = await fetch(`${NOTION_API_ORIGIN}/v1/pages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getNotionToken()}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: {
        data_source_id: dataSourceId,
      },
      properties,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Notion API failed with status ${response.status}`);
  }

  return JSON.parse(text) as { id?: string };
}

export async function updateNotionPage(pageId: string, properties: Record<string, unknown>) {
  const response = await fetch(`${NOTION_API_ORIGIN}/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${getNotionToken()}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Notion API failed with status ${response.status}`);
  }
}

export function nextLevel(level: string) {
  const currentIndex = STAR_LEVELS.indexOf(level as (typeof STAR_LEVELS)[number]);
  if (currentIndex === -1) return STAR_LEVELS[0];
  return STAR_LEVELS[Math.min(currentIndex + 1, STAR_LEVELS.length - 1)];
}
