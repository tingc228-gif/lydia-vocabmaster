import type { PetState } from '../types';

export interface NotionTodayWord {
  id: string;
  word: string;
  meaning: string;
  level: string;
  nextReview: string;
}

export interface NotionTodayWordsResponse {
  date: string;
  count: number;
  items: NotionTodayWord[];
  wordsText: string;
}

export interface NotionReviewUpdatePayload {
  items: NotionTodayWord[];
  incorrectWords: string[];
}

export interface NotionPetStateResponse {
  id: string;
  name: string;
  foodPercent: number;
  joyPercent: number;
  growthPercent: number;
  careRound: number;
  lastSynced: string;
}

function getPetStateURL() {
  if (typeof window === 'undefined') {
    return 'http://localhost:47821/api/notion-pet-state';
  }

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:47821/api/notion-pet-state';
  }

  return `${window.location.origin}/api/notion-pet-state`;
}

function getNotionFunctionURL() {
  if (typeof window === 'undefined') {
    return 'http://localhost:47821/api/notion-today-words';
  }

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:47821/api/notion-today-words';
  }

  return `${window.location.origin}/api/notion-today-words`;
}

function getNotionReviewCompleteURL() {
  if (typeof window === 'undefined') {
    return 'http://localhost:47821/api/notion-review-complete';
  }

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:47821/api/notion-review-complete';
  }

  return `${window.location.origin}/api/notion-review-complete`;
}

function formatMissingNotionEnvMessage(variableName: string): string {
  const isLocal =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  if (isLocal) {
    return [
      'Notion sync is not configured yet.',
      `Missing environment variable: ${variableName}`,
      'Add it to your local environment and restart `vercel dev`.',
    ].join('\n');
  }

  return [
    'Notion sync is not configured yet.',
    `Missing server environment variable: ${variableName}`,
    'Open your deployment environment settings, add the variable, then redeploy the site.',
  ].join('\n');
}

function normalizeNotionError(raw: string) {
  const text = raw.trim();
  if (!text) return text;

  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === 'string') {
      if (parsed.error.includes('Missing NOTION_TOKEN environment variable')) {
        return formatMissingNotionEnvMessage('NOTION_TOKEN');
      }
      if (parsed.error.includes('Missing NOTION_DATA_SOURCE_ID environment variable')) {
        return formatMissingNotionEnvMessage('NOTION_DATA_SOURCE_ID');
      }
      if (parsed.error.includes('Missing NOTION_PET_STATE_DATA_SOURCE_ID environment variable')) {
        return formatMissingNotionEnvMessage('NOTION_PET_STATE_DATA_SOURCE_ID');
      }
      return parsed.error;
    }
  } catch {
    // Ignore JSON parsing failure and return the original string.
  }

  return text;
}

export async function loadTodayWordsFromNotion(): Promise<NotionTodayWordsResponse> {
  const response = await fetch(getNotionFunctionURL());
  const text = await response.text();

  if (!response.ok) {
    throw new Error(normalizeNotionError(text) || 'Failed to load today\'s Notion words.');
  }

  return JSON.parse(text) as NotionTodayWordsResponse;
}

export async function syncCompletedReviewToNotion(payload: NotionReviewUpdatePayload): Promise<{ updatedCount: number; leveledUpCount: number; date: string }> {
  const response = await fetch(
    getNotionReviewCompleteURL(),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(normalizeNotionError(text) || 'Failed to write review results back to Notion.');
  }

  return JSON.parse(text) as { updatedCount: number; leveledUpCount: number; date: string };
}

export async function loadPetStateFromNotion(): Promise<NotionPetStateResponse> {
  const response = await fetch(getPetStateURL());
  const text = await response.text();

  if (!response.ok) {
    throw new Error(normalizeNotionError(text) || 'Failed to load the pet state from Notion.');
  }

  return JSON.parse(text) as NotionPetStateResponse;
}

export async function savePetStateToNotion(
  payload: Pick<PetState, 'foodPercent' | 'joyPercent' | 'growthPercent' | 'careRound'> & { id?: string },
): Promise<NotionPetStateResponse> {
  const response = await fetch(getPetStateURL(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(normalizeNotionError(text) || 'Failed to save the pet state to Notion.');
  }

  return JSON.parse(text) as NotionPetStateResponse;
}
