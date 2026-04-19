import { OpenAI } from "openai";
import { LearningData, SentenceClozeQuestion, VocabularyInContextQuestion } from "../types";

const MOONSHOT_MODEL = "kimi-k2.5";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatMissingEnvMessage(variableName: string, providerName: string): string {
  const isLocal =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  if (isLocal) {
    return [
      `${providerName} is not configured yet.`,
      `Missing environment variable: ${variableName}`,
      'For local testing, add it to your local environment and run the app with `vercel dev`.',
    ].join('\n');
  }

  return [
    `${providerName} is not configured yet.`,
    `Missing server environment variable: ${variableName}`,
    'Open your deployment environment settings, add the variable, then redeploy the site.',
  ].join('\n');
}

function normalizeKnownErrorMessage(rawMessage: string): string {
  const compact = rawMessage.trim();
  if (!compact) return compact;

  if (compact.includes('Missing MOONSHOT_API_KEY or KIMI_API_KEY environment variable')) {
    return formatMissingEnvMessage('MOONSHOT_API_KEY', 'Moonshot / Kimi');
  }

  if (compact.includes('Missing MINIMAX_API_KEY environment variable')) {
    return formatMissingEnvMessage('MINIMAX_API_KEY', 'MiniMax story generation');
  }

  if (
    compact.includes('Upstream AI request timed out') ||
    compact.includes('An error occurred with your deployment')
  ) {
    return 'The AI service took too long to answer. Please try again in a moment.';
  }

  return compact;
}

function extractMessageFromText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return normalizeKnownErrorMessage(parsed.error);
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return normalizeKnownErrorMessage(parsed.message);
    }
  } catch {
    // Fall back to using the raw text when it is not JSON.
  }

  return normalizeKnownErrorMessage(trimmed);
}

function extractErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const maybeError = error as {
      message?: string;
      status?: number;
      code?: string;
      error?: { message?: string; code?: string; type?: string };
      response?: { status?: number; data?: unknown; text?: string };
    };

    const parts = [
      maybeError.message ? extractMessageFromText(maybeError.message) : undefined,
      maybeError.error?.message ? extractMessageFromText(maybeError.error.message) : undefined,
      typeof maybeError.response?.data === 'string' ? extractMessageFromText(maybeError.response.data) : undefined,
      maybeError.response?.text ? extractMessageFromText(maybeError.response.text) : undefined,
      maybeError.code,
      maybeError.error?.code,
      maybeError.error?.type,
    ].filter(Boolean);

    if (parts.length > 0) {
      return parts.join('\n');
    }

    if (maybeError.status) {
      return `${maybeError.status} status code`;
    }
  }

  return error instanceof Error ? extractMessageFromText(error.message) || error.message : String(error);
}

function isTimeoutLikeError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase();
  return (
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('task timed out') ||
    message.includes('504') ||
    message.includes('deployment') ||
    message.includes('upstream ai request timed out') ||
    message.includes('too long to answer') ||
    message.includes('please try again in a moment')
  );
}

function isProviderBusyError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase();
  return (
    message.includes('429') ||
    message.includes('too many requests') ||
    message.includes('rate limit') ||
    message.includes('overloaded') ||
    message.includes('engine_overloaded_error') ||
    message.includes('service unavailable') ||
    message.includes('temporarily unavailable') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('deployment') ||
    message.includes('upstream ai request timed out') ||
    message.includes('too long to answer') ||
    message.includes('please try again in a moment')
  );
}

const PROVIDER_ATTEMPT_TIMEOUT_MS = 90000;

async function withAttemptTimeout<T>(
  task: () => Promise<T>,
  label: string,
  timeoutMs: number = PROVIDER_ATTEMPT_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      task(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function withProviderRetries<T>(
  task: () => Promise<T>,
  label: string,
  maxAttempts: number = 3,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await withAttemptTimeout(task, label);
    } catch (error) {
      lastError = error;

      if ((!isProviderBusyError(error) && !isTimeoutLikeError(error)) || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = 1200 * attempt;
      console.warn(`${label} hit a busy provider response. Retrying in ${delayMs}ms.`, error);
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed.`);
}

interface ParsedWordInput {
  word: string;
  providedDefinition?: string;
}

function parseWordInputs(rawWords: string): ParsedWordInput[] {
  return rawWords
    .split(/\n+/)
    .flatMap((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return [];

      const hasInlineDefinition = /^(.+?)\s*(?:—|–|-|:)\s+(.+)$/.test(trimmedLine);
      if (hasInlineDefinition) {
        // When a line already contains "word — definition", keep the whole
        // definition together so commas or semicolons inside it are not treated
        // as additional words.
        return [trimmedLine];
      }

      return trimmedLine.split(/[，,；;](?=(?:[^"]*"[^"]*")*[^"]*$)/);
    })
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.+?)\s*(?:—|–|-|:)\s+(.+)$/);
      if (!match) {
        return { word: entry };
      }

      return {
        word: match[1].trim(),
        providedDefinition: match[2].trim(),
      };
    })
    .filter((item) => item.word.length > 0);
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return text;
  return text.slice(start, end + 1);
}

function normalizeOptionText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.]+$/g, '');
}

function uniqueNormalizedStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const item of items) {
    const normalized = normalizePhrase(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(item.trim());
  }

  return results;
}

function ensureChoiceOptions(answer: string, rawOptions: unknown[], fallbackPool: string[]): string[] {
  const cleanedAnswer = normalizeOptionText(answer);
  const uniqueOptions = uniqueNormalizedStrings(
    [
      ...rawOptions.map((option) => normalizeOptionText(option)),
      cleanedAnswer,
      ...fallbackPool.map((item) => normalizeOptionText(item)),
    ].filter(Boolean),
  ).filter((option) => option.length > 0);

  const limited = uniqueOptions.slice(0, 4);
  if (!limited.some((option) => normalizePhrase(option) === normalizePhrase(cleanedAnswer))) {
    limited[0] = cleanedAnswer;
  }

  return shuffleWords(limited).slice(0, 4);
}

function conciseMeaningChoice(text: string): string {
  return normalizeOptionText(
    text
      .split(/\bor\b|;|\(|\)/i)[0]
      .replace(/^to\s+/i, 'to ')
      .replace(/^someone who is\s+/i, '')
      .replace(/^someone who\s+/i, '')
      .replace(/^someone\s+/i, '')
      .replace(/^something that is\s+/i, '')
      .replace(/^something\s+/i, '')
      .replace(/^the act of\s+/i, '')
      .trim(),
  );
}

function normalizePhrase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function getWordKey(value: string): string {
  return normalizePhrase(value) || value.toLowerCase().trim();
}

function textContainsTargetWord(text: string, targetWord: string): boolean {
  const normalizedText = normalizePhrase(text);
  const normalizedTarget = getWordKey(targetWord);
  return Boolean(normalizedText && normalizedTarget && normalizedText.includes(normalizedTarget));
}

function isPhrasalVerb(word: string): boolean {
  return /\s/.test(word.trim()) || /-/.test(word.trim());
}

const PHRASAL_KEYWORD_SYNONYMS: Array<{ keywords: string[]; synonym: string }> = [
  { keywords: ['appear', 'be found', 'be discovered', 'be noticed'], synonym: 'appear' },
  { keywords: ['arrive', 'come', 'reach'], synonym: 'arrive' },
  { keywords: ['reject', 'refuse'], synonym: 'reject' },
  { keywords: ['accept', 'agree'], synonym: 'accept' },
  { keywords: ['delay', 'postpone'], synonym: 'delay' },
  { keywords: ['escape', 'avoid'], synonym: 'escape' },
  { keywords: ['continue', 'keep'], synonym: 'continue' },
  { keywords: ['discover', 'find out'], synonym: 'discover' },
  { keywords: ['remove', 'eliminate'], synonym: 'remove' },
  { keywords: ['enter', 'visit'], synonym: 'enter' },
  { keywords: ['leave', 'depart'], synonym: 'leave' },
  { keywords: ['record', 'write down'], synonym: 'record' },
  { keywords: ['recover', 'feel better'], synonym: 'recover' },
  { keywords: ['invent', 'create'], synonym: 'invent' },
  { keywords: ['yield', 'surrender'], synonym: 'yield' },
  { keywords: ['stop', 'prevent'], synonym: 'stop' },
];

function looksLikeDefinitionSynonym(synonym: string, definition: string): boolean {
  const normalizedSynonym = normalizePhrase(synonym);
  const normalizedDefinition = normalizePhrase(definition);

  if (!normalizedSynonym) return true;
  if (normalizedDefinition && normalizedSynonym === normalizedDefinition) return true;
  if (normalizedDefinition && normalizedDefinition.includes(normalizedSynonym) && normalizedSynonym.split(' ').length >= 3) {
    return true;
  }

  const definitionMarkers = [
    'someone',
    'something',
    'person',
    'people',
    'in a way',
    'able to',
    'used to',
    'means',
    'that is',
    'very',
    'kind of',
  ];

  if (definitionMarkers.some((marker) => normalizedSynonym.includes(marker))) return true;
  if (synonym.split(/\s+/).length > 3) return true;
  if (/[.:;]/.test(synonym)) return true;

  return false;
}

function getSynonymCandidates(word: string, definition: string): string[] {
  const normalizedWord = normalizePhrase(word);
  const cleanedDefinition = definition
    .replace(/^to\s+/i, '')
    .replace(/^[a-z]+\.\s*/i, '')
    .replace(/[.;:!?]+$/g, '')
    .trim();
  const candidates: string[] = [];

  if (isPhrasalVerb(word)) {
    const phrasalCandidates = cleanedDefinition
      .split(/\bor\b|,|;|\(|\)|\/| and /i)
      .map((part) =>
        part
          .replace(/^to\s+/i, '')
          .replace(/^be\s+/i, '')
          .replace(/^become\s+/i, '')
          .replace(/^start to\s+/i, '')
          .replace(/^begin to\s+/i, '')
          .replace(/^continue to\s+/i, 'continue ')
          .replace(/^cause someone to\s+/i, '')
          .replace(/^cause something to\s+/i, '')
          .replace(/^make someone\s+/i, '')
          .replace(/^make something\s+/i, '')
          .replace(/^move\s+/i, 'move ')
          .replace(/^go\s+/i, 'go ')
          .trim(),
      )
      .map((part) => part.replace(/\s+/g, ' '))
      .filter(Boolean)
      .filter((part) => !looksLikeDefinitionSynonym(part, definition))
      .filter((part) => normalizePhrase(part) !== normalizedWord)
      .filter((part) => part.split(' ').length <= 2)
      .sort((a, b) => a.split(' ').length - b.split(' ').length || a.length - b.length);

    candidates.push(...phrasalCandidates);

    const normalizedDefinition = normalizePhrase(cleanedDefinition);
    for (const entry of PHRASAL_KEYWORD_SYNONYMS) {
      if (entry.keywords.some((keyword) => normalizedDefinition.includes(keyword))) {
        candidates.push(entry.synonym);
      }
    }
  }

  const definitionCandidates = cleanedDefinition
    .split(/\bor\b|,|;|\(|\)/i)
    .map((part) =>
      part
        .replace(/^someone who is\s+/i, '')
        .replace(/^someone\s+/i, '')
        .replace(/^something\s+/i, '')
        .replace(/^able to\s+/i, '')
        .replace(/^in a way that is\s+/i, '')
        .replace(/^in a way that\s+/i, '')
        .replace(/^in a\s+/i, '')
        .replace(/^very\s+/i, '')
        .replace(/^full of\s+/i, '')
        .replace(/^willing to\s+/i, '')
        .replace(/^made\s+.+?\s+(interested|curious)$/i, '$1')
        .trim(),
    )
    .map((part) => part.replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((part) => normalizePhrase(part) !== normalizedWord)
    .filter((part) => !looksLikeDefinitionSynonym(part, definition))
    .sort((a, b) => a.split(' ').length - b.split(' ').length || a.length - b.length);

  candidates.push(...definitionCandidates);

  return candidates
    .map((candidate) => candidate.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((candidate, index, array) => array.findIndex((item) => normalizePhrase(item) === normalizePhrase(candidate)) === index)
    .filter((candidate) => normalizePhrase(candidate) !== normalizedWord)
    .filter((candidate) => !looksLikeDefinitionSynonym(candidate, definition));
}

function fallbackSynonym(word: string, definition: string, usedSynonyms: Set<string> = new Set()): string {
  const candidates = getSynonymCandidates(word, definition);

  const uniqueCandidate = candidates.find((candidate) => !usedSynonyms.has(normalizePhrase(candidate)));
  if (uniqueCandidate) return uniqueCandidate;

  const firstCandidate = candidates[0];
  if (firstCandidate) return firstCandidate;

  const definitionWordFallback = definition
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !['someone', 'something', 'person', 'people', 'very', 'really', 'that', 'which', 'with', 'from', 'into', 'able', 'used', 'kind', 'means', 'make', 'made', 'causes', 'cause', 'way'].includes(part))
    .find((part) => part.length >= 4 && part !== normalizePhrase(word));

  if (definitionWordFallback && !usedSynonyms.has(definitionWordFallback)) {
    return definitionWordFallback;
  }

  return isPhrasalVerb(word) ? 'action' : 'similar';
}

function replaceWordWithBlank(sentence: string, answer: string, blankId: string): string {
  if (!sentence.trim()) {
    return `[${blankId}]`;
  }

  if (sentence.includes('___')) {
    return sentence.replace('___', `[${blankId}]`);
  }

  const escapedAnswer = answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactWordMatch = new RegExp(`\\b${escapedAnswer}\\b`, 'i');
  if (exactWordMatch.test(sentence)) {
    return sentence.replace(exactWordMatch, `[${blankId}]`);
  }

  return `${sentence.trim()} [${blankId}]`;
}

function buildFallbackExample(word: string, definition: string, partOfSpeech: string): string {
  const cleanWord = word.trim();
  const cleanDef = definition.trim().replace(/[.]+$/g, '');
  const pos = partOfSpeech.toLowerCase();

  if (!cleanWord) return 'No example available.';

  // Build a simple but honest sentence: "Word means definition."
  // This is better than a grammatically broken template.
  if (cleanDef && cleanDef.length > 3 && !cleanDef.toLowerCase().includes('unavailable')) {
    // For phrasal verbs / multi-word expressions, use "To X means ..."
    if (isPhrasalVerb(cleanWord) || /\bverb\b/.test(pos) || /\bv\b/.test(pos)) {
      return `To ${cleanWord} means to ${cleanDef.replace(/^to\s+/i, '').toLowerCase()}.`;
    }
    // For adjectives: "Something that is X is definition."
    if (/\badj\b/.test(pos)) {
      return `If something is ${cleanWord}, it is ${cleanDef.toLowerCase()}.`;
    }
    // For adverbs: "To do something X means definition."
    if (/\badv\b/.test(pos)) {
      return `To do something ${cleanWord} means to do it ${cleanDef.replace(/^in a .+ way$/i, '').toLowerCase()}.`;
    }
    // For nouns
    if (/\bnoun\b/.test(pos) || /\bn\b/.test(pos)) {
      const article = /^[aeiou]/i.test(cleanWord) ? 'An' : 'A';
      return `${article} ${cleanWord} is ${cleanDef.toLowerCase()}.`;
    }
    // Generic fallback with definition
    return `The word "${cleanWord}" means ${cleanDef.toLowerCase()}.`;
  }

  return `The word "${cleanWord}" is one of the vocabulary words in this set.`;
}

function sanitizeDefinitionForExplanation(definition: string): string {
  return definition.trim().replace(/[.]+$/g, '').replace(/\s+/g, ' ');
}

function buildContextualBlankExplanation(word: string, definition: string): string {
  const cleanWord = word.trim();
  const cleanDefinition = sanitizeDefinitionForExplanation(definition);

  if (!cleanWord) {
    return 'This word is the best fit because it matches what is happening in this part of the story.';
  }

  if (cleanDefinition) {
    return `${cleanWord} is the best choice here because this part of the story needs a word meaning ${cleanDefinition.toLowerCase()}, so it matches what is happening in the sentence.`;
  }

  return `${cleanWord} is the best choice here because it matches what is happening in this part of the story.`;
}

function looksLikeDefinitionOnlyExplanation(explanation: string): boolean {
  const compact = explanation.trim().toLowerCase();
  if (!compact) return true;

  return (
    compact.includes(' means ') ||
    compact.startsWith('means ') ||
    compact.startsWith('to ') ||
    compact.startsWith('a ') ||
    compact.startsWith('an ') ||
    compact.startsWith('the word ') ||
    compact.startsWith('this word ') ||
    compact === 'this word fits the story best here.' ||
    compact === 'no explanation provided.'
  );
}

function ensurePlayableExample(word: string, definition: string, partOfSpeech: string, maybeExample: string): string {
  const trimmed = maybeExample.trim();
  if (!trimmed) {
    return buildFallbackExample(word, definition, partOfSpeech);
  }

  const normalized = trimmed.toLowerCase();
  if (
    normalized.includes('appears in this study set') ||
    normalized.includes('during the class story') ||
    normalized.includes('in the story') && normalized.includes(' means ') ||
    normalized.includes('means ') ||
    normalized.includes('used ${')
  ) {
    return buildFallbackExample(word, definition, partOfSpeech);
  }

  return trimmed;
}

function looksLikeDefinitionDrill(text: string): boolean {
  const compact = text.trim().toLowerCase();
  if (!compact) return true;

  const sentenceLabelCount = (compact.match(/sentence\s+\d+\s*:/g) || []).length;
  const meansCount = (compact.match(/\bmeans\b/g) || []).length;
  const blankCount = (compact.match(/\[blank_\d+\]/g) || []).length;

  return sentenceLabelCount >= 2 || (meansCount >= Math.max(2, blankCount - 1));
}

// Sentinel string embedded in every fallback article so we can detect them
// without relying on human-readable phrases that overlap with template text.
const FALLBACK_SENTINEL = '\u200b\u200b\u200b';

function looksLikeWeakFallbackStory(text: string): boolean {
  // Primary: sentinel embedded by buildFallbackArticles.
  if (text.includes(FALLBACK_SENTINEL)) return true;

  // Secondary: unmistakable signs of bad AI output.
  const compact = text.trim().toLowerCase();
  return (
    compact.includes('appears in this study set') ||
    compact.includes('the word [blank_')
  );
}

function buildStorySentence(
  word: LearningData["words"][number],
  blankId: string,
  index: number,
  total: number,
): string {
  const blank = `[${blankId}]`;
  const pos = word.partOfSpeech.toLowerCase();
  const phase = total <= 1 ? 0.5 : index / Math.max(1, total - 1);

  const openingTemplates = {
    adjective: [
      `At the start of rehearsal, the backstage room felt ${blank}, and everyone noticed the mood right away.`,
      `As the students gathered by the curtain, Mia looked ${blank}, but she still smiled at her friends.`,
    ],
    adverb: [
      `Before the audience arrived, Leo moved ${blank} through the hallway to check every prop.`,
      `The helpers worked ${blank} as they decorated the stage before the first bell.`,
    ],
    verb: [
      `Just as the practice began, Mia had to ${blank} before the teacher called everyone together.`,
      `At the beginning of the afternoon, the class tried to ${blank} while the stage was still quiet.`,
    ],
    noun: [
      `Before anyone could panic, ${blank} became the first problem the class needed to solve.`,
      `At the start of the showcase, the teacher pointed to ${blank} and asked everyone to stay calm.`,
    ],
    generic: [
      `At the beginning of the story, ${blank} was already part of the mystery the class had to solve.`,
      `When the rehearsal first began, ${blank} seemed more important than anyone expected.`,
    ],
  };

  const middleTemplates = {
    adjective: [
      `While the students searched for answers, the room grew ${blank}, and even the quietest child started asking questions.`,
      `Halfway through practice, Mia became ${blank} when she realized the missing prop still had not appeared.`,
    ],
    adverb: [
      `To keep the plan from falling apart, the team moved ${blank} from one task to the next.`,
      `During the busiest part of rehearsal, Leo spoke ${blank} so the younger students would not worry.`,
    ],
    verb: [
      `When the problem became harder, the class decided to ${blank} instead of giving up.`,
      `As the noise in the room grew louder, Mia knew she had to ${blank} before the principal arrived.`,
    ],
    noun: [
      `In the middle of the confusion, ${blank} turned out to be the clue that helped everything make sense.`,
      `By then, everyone understood that ${blank} was connected to the missing costume and the late music cue.`,
    ],
    generic: [
      `In the middle of the adventure, ${blank} suddenly explained why the plan had gone wrong.`,
      `As the story moved on, ${blank} became the turning point the class had been waiting for.`,
    ],
  };

  const endingTemplates = {
    adjective: [
      `By the final scene, everyone felt ${blank}, and the applause sounded even warmer because of it.`,
      `When the curtain finally lifted, Mia looked ${blank}, knowing the hardest part was over.`,
    ],
    adverb: [
      `In the last few minutes, the team finished ${blank}, and the audience never guessed how close they were to disaster.`,
      `At the end of the afternoon, Leo waved ${blank} from the wings as the class took their bow.`,
    ],
    verb: [
      `When the showcase was saved at last, the class could finally ${blank} and enjoy the moment together.`,
      `As the crowd cheered, Mia remembered how hard everyone had worked to ${blank} before the curtain rose.`,
    ],
    noun: [
      `In the end, ${blank} was the lesson the class remembered long after the applause faded.`,
      `By the time the showcase ended, ${blank} had become the reason everyone laughed with relief.`,
    ],
    generic: [
      `At the end of the story, ${blank} helped the whole adventure land in exactly the right way.`,
      `When everything was over, ${blank} was the detail everyone kept talking about on the walk home.`,
    ],
  };

  let bucketSet = middleTemplates;
  if (phase < 0.34) bucketSet = openingTemplates;
  else if (phase > 0.67) bucketSet = endingTemplates;

  let bucket = bucketSet.generic;
  if (/\badj\b/.test(pos)) bucket = bucketSet.adjective;
  else if (/\badv\b/.test(pos)) bucket = bucketSet.adverb;
  else if (/\bv\b/.test(pos) || isPhrasalVerb(word.word)) bucket = bucketSet.verb;
  else if (/\bn\b/.test(pos)) bucket = bucketSet.noun;

  return bucket[index % bucket.length];
}

// Five rotating fallback scenarios so repeated failures don't all look identical.
const FALLBACK_SCENARIOS = [
  {
    intro: 'On a quiet Tuesday, Sam and Jordan arrived at the school library to find the shelves rearranged, the librarian missing, and a single note taped to the door asking for help.',
    bridge: 'Working together, the two friends took turns searching the shelves and listing clues in a notebook, slowly piecing together why the books had been moved.',
    mid: 'For a while it seemed the mystery had no answer, but they kept searching rather than giving up.',
    outro: 'By the time the last bell rang, the library was back in order and both friends had learned something new about patience.',
  },
  {
    intro: 'Science day arrived suddenly, and the class discovered that half the experiment supplies were missing from the lab cupboard, leaving everyone scrambling before the judges appeared.',
    bridge: 'Instead of panicking, the group divided the tasks, shared their remaining materials, and adapted each step of the experiment to fit what they had.',
    mid: 'More than once it looked like the experiment might have to stop, yet no one was willing to admit defeat.',
    outro: 'When the judges finally arrived, the class presented a result none of them had expected, and it turned out better than the original plan.',
  },
  {
    intro: 'On the morning of the big match, the coach discovered that the equipment bag had been left at school, sending the whole team into a quiet panic.',
    bridge: 'Several players volunteered to go back for the bag while others warmed up and kept everyone calm on the sideline.',
    mid: 'The delay made everything feel uncertain, but the team stayed focused and kept encouraging each other.',
    outro: 'Once the whistle blew and the match began, all the earlier trouble seemed far away, and the team played their best game of the season.',
  },
  {
    intro: 'In the school kitchen, the cooking class found that the recipe cards had been mixed up, meaning every group was looking at instructions meant for a completely different dish.',
    bridge: 'The students compared cards, traded ingredients across tables, and adjusted measurements as they went, turning the mix-up into a team challenge.',
    mid: 'Some steps did not go quite right the first time, but everyone kept trying and helped neighbours fix small mistakes.',
    outro: 'The dishes that came out of the oven were different from the originals, yet the class agreed they tasted even better than expected.',
  },
  {
    intro: 'The art teacher set up five stations around the room for a gallery day, then realised the display boards had been delivered to the wrong classroom at the other end of the building.',
    bridge: 'Students carried boards in small groups, set them up without a diagram to follow, and arranged the artwork in an order that felt right to them.',
    mid: 'At one point the display nearly fell, but quick hands steadied it and the group laughed and carried on.',
    outro: 'Parents who visited that afternoon said the gallery looked carefully planned, never guessing that everything had been improvised on the spot.',
  },
];

function buildFallbackArticles(words: LearningData["words"], articleCount: number): LearningData["articles"] {
  const safeArticleCount = Math.max(1, articleCount);
  const chunks: typeof words[] = Array.from({ length: safeArticleCount }, () => []);

  words.forEach((word, index) => {
    chunks[index % safeArticleCount].push(word);
  });

  return chunks
    .filter((chunk) => chunk.length > 0)
    .map((chunk, articleIndex) => {
      const scenario = FALLBACK_SCENARIOS[articleIndex % FALLBACK_SCENARIOS.length];

      const blankSentences = chunk.map((word, index) => {
        const blankId = `blank_${index}`;
        const sourceSentence = (word.exampleSentenceWithBlank || word.exampleSentence || '').trim();
        const normalizedSource = sourceSentence.toLowerCase();

        if (!sourceSentence || normalizedSource.includes('appears in this study set')) {
          return buildStorySentence(word, blankId, index, chunk.length);
        }

        return replaceWordWithBlank(sourceSentence, word.word, blankId).trim().replace(/\s+/g, ' ');
      });

      // FALLBACK_SENTINEL (zero-width spaces) marks this article as a fallback
      // so looksLikeWeakFallbackStory() can detect it without relying on
      // human-readable template strings.
      return {
        text: [
          FALLBACK_SENTINEL,
          scenario.intro,
          ...blankSentences.slice(0, Math.ceil(blankSentences.length / 3)),
          scenario.bridge,
          ...blankSentences.slice(Math.ceil(blankSentences.length / 3), Math.ceil((blankSentences.length * 2) / 3)),
          scenario.mid,
          ...blankSentences.slice(Math.ceil((blankSentences.length * 2) / 3)),
          scenario.outro,
        ].join(' '),
        blanks: chunk.map((word, index) => ({
          id: `blank_${index}`,
          answer: word.word,
          explanation: buildContextualBlankExplanation(word.word, word.definition),
        })),
        distractors: words
          .filter((candidate) => !chunk.some((item) => item.word === candidate.word))
          .slice(articleIndex * 2, articleIndex * 2 + 2)
          .map((word) => word.word),
      };
    })
    .map((article, articleIndex, articles) => ({
      ...article,
      distractors:
        article.distractors.length >= 2
          ? article.distractors.slice(0, 2)
          : words
              .filter((candidate) => !article.blanks.some((blank) => blank.answer === candidate.word))
              .map((word) => word.word)
              .filter((word) => !article.distractors.includes(word))
              .slice(0, Math.max(0, 2 - article.distractors.length))
              .concat(article.distractors)
              .slice(0, 2),
    }));
}

async function repairWeakArticles(
  openai: OpenAI,
  data: LearningData,
): Promise<LearningData["articles"]> {
  const weakTargets = data.articles
    .map((article, index) => ({ article, index }))
    .filter(({ article }) => looksLikeDefinitionDrill(article.text) || looksLikeWeakFallbackStory(article.text));

  if (weakTargets.length === 0) {
    return data.articles;
  }

  const articlePrompt = weakTargets
    .map(({ article, index }) => {
      const blankDetails = article.blanks
        .map((blank) => {
          const wordInfo = data.words.find((word) => word.word === blank.answer);
          return `${blank.id}=${blank.answer}; partOfSpeech=${wordInfo?.partOfSpeech || 'word'}; definition=${wordInfo?.definition || ''}`;
        })
        .join('\n');

      return `Article index ${index}
Required blanks in order:
${blankDetails}
Existing distractors: ${article.distractors.join(', ')}
Need: one coherent short story or passage, not isolated practice sentences. Keep the same blank ids in the text.`;
    })
    .join('\n\n');

  const response = await withProviderRetries(
    () =>
      openai.chat.completions.create({
        model: MOONSHOT_MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You rewrite weak vocabulary passages into coherent short stories. Return strictly valid JSON only. Each article must read like one connected story, not separate sentence drills.",
          },
          {
            role: "user",
            content: `Return JSON in this exact shape:
{"articles":[{"index":0,"text":"The girl felt [blank_0] as she stepped onto the stage, and the lights began to [blank_1] above her.","blanks":[{"id":"blank_0","answer":"brave","explanation":"brave fits because she overcame her fear"},{"id":"blank_1","answer":"sparkle","explanation":"sparkle describes the shining lights"}],"distractors":["quiet","heavy"]}]}

Rules:
- Keep each article as one connected story or article passage.
- In the "text" field, replace each vocabulary word with its placeholder [blank_0], [blank_1], etc. Do NOT write the actual word in the text — use only the [blank_N] marker.
- Keep the same blank ids and answers.
- Each blank explanation must say why that word fits this specific part of the story or sentence.
- Do not write dictionary-only explanations like "X means...".
- Keep distractors to exactly 2 items.

${articlePrompt}`,
          },
        ],
        max_tokens: 2500,
      }),
    'Story repair',
  );

  const content = extractJsonObject(response.choices[0].message.content || "{}");
  let parsed: {
    articles?: Array<{
      index?: number;
      text?: string;
      blanks?: Array<{ id?: string; answer?: string; explanation?: string }>;
      distractors?: string[];
    }>;
  };

  try {
    parsed = JSON.parse(content);
  } catch {
    const repaired = content.replace(/,?\s*$/, '') + ']}';
    try {
      parsed = JSON.parse(repaired);
    } catch {
      return data.articles;
    }
  }

  const repairedMap = new Map<number, LearningData["articles"][number]>();

  for (const item of parsed.articles || []) {
    const index = Number(item.index);
    if (!Number.isInteger(index)) continue;

    const original = data.articles[index];
    if (!original) continue;

    const repairedArticle = {
      text: String(item.text || '').trim(),
      blanks: Array.isArray(item.blanks)
        ? item.blanks.map((blank, blankIndex) => ({
            id: String(blank.id || `blank_${blankIndex}`),
            answer: String(blank.answer || '').trim(),
            explanation: String(blank.explanation || '').trim() || 'This word fits this part of the story best.',
          }))
        : original.blanks,
      distractors: Array.isArray(item.distractors)
        ? item.distractors.map((word) => String(word || '').trim()).filter(Boolean).slice(0, 2)
        : original.distractors,
    };

    if (
      repairedArticle.text &&
      repairedArticle.blanks.length === original.blanks.length &&
      !looksLikeDefinitionDrill(repairedArticle.text) &&
      !looksLikeWeakFallbackStory(repairedArticle.text)
    ) {
      repairedMap.set(index, repairedArticle);
    }
  }

  return data.articles.map((article, index) => repairedMap.get(index) || article);
}

function buildArticleChunks(words: LearningData["words"], articleCount: number) {
  const safeArticleCount = Math.max(1, articleCount);
  const chunks: typeof words[] = Array.from({ length: safeArticleCount }, () => []);

  words.forEach((word, index) => {
    chunks[index % safeArticleCount].push(word);
  });

  return chunks.filter((chunk) => chunk.length > 0);
}

type StoryBlueprint = {
  label: string;
  setting: string;
  lead: string;
  challenge: string;
  resolution: string;
  mood: string;
  avoid: string[];
};

const STORY_BLUEPRINTS: StoryBlueprint[] = [
  {
    label: 'Community Garden Rescue',
    setting: 'a neighborhood garden right after heavy rain',
    lead: 'two children helping a grandparent and a next-door neighbor',
    challenge: 'save the plants and organize the tools before visitors arrive',
    resolution: 'the garden opens on time and everyone sees how much teamwork mattered',
    mood: 'outdoor, practical, warm, hopeful',
    avoid: ['stage', 'audience', 'song', 'microphone', 'director', 'performance'],
  },
  {
    label: 'Museum Puzzle Trip',
    setting: 'a class trip inside a natural history museum',
    lead: 'a small group of classmates following clues with their teacher',
    challenge: 'solve a missing-label mystery before the guided tour ends',
    resolution: 'the clue trail leads to a clever museum worker and the exhibit is fixed',
    mood: 'curious, thoughtful, adventurous',
    avoid: ['kitchen', 'garden', 'match', 'race', 'stage', 'concert'],
  },
  {
    label: 'Beach Cleanup Morning',
    setting: 'an early-morning beach cleanup by the sea',
    lead: 'siblings working with a volunteer team',
    challenge: 'finish a cleanup plan while the tide is changing',
    resolution: 'the beach becomes safe again and the team finds an unexpected reward',
    mood: 'breezy, active, cooperative',
    avoid: ['school stage', 'theater', 'microphone', 'rehearsal', 'gallery', 'museum'],
  },
  {
    label: 'Kitchen Mix-Up',
    setting: 'a busy family kitchen before a shared meal',
    lead: 'cousins cooking together while an older relative gives advice',
    challenge: 'recover from a recipe mix-up without ruining dinner',
    resolution: 'the meal turns out differently from planned but everyone loves it',
    mood: 'homey, funny, slightly hectic',
    avoid: ['stage', 'audience', 'song', 'sports field', 'museum', 'beach'],
  },
  {
    label: 'Forest Trail Map',
    setting: 'a nature trail during a school camp',
    lead: 'friends hiking with a map and a camp leader nearby',
    challenge: 'find the right trail markers before sunset',
    resolution: 'they return safely after learning how to trust one another',
    mood: 'calm, outdoorsy, quietly suspenseful',
    avoid: ['theater', 'microphone', 'kitchen', 'museum hall', 'gallery'],
  },
  {
    label: 'Pet Shelter Afternoon',
    setting: 'an animal shelter during adoption day',
    lead: 'children helping a shelter worker and nervous animals',
    challenge: 'prepare the shelter before visiting families arrive',
    resolution: 'the animals calm down and the day ends with good news',
    mood: 'gentle, caring, lively',
    avoid: ['stage', 'concert', 'race', 'cooking class', 'museum'],
  },
  {
    label: 'Train Station Mix-Up',
    setting: 'a crowded train station during a family trip',
    lead: 'siblings, a parent, and a helpful stranger',
    challenge: 'recover a lost bag and reach the right platform in time',
    resolution: 'they board safely and laugh about the confusion afterward',
    mood: 'fast-moving, urban, relieving',
    avoid: ['stage', 'audience', 'garden', 'kitchen', 'gallery'],
  },
  {
    label: 'Art Gallery Setup',
    setting: 'a school art gallery being prepared for visitors',
    lead: 'students arranging paintings and signs with their art teacher',
    challenge: 'finish the display after a last-minute accident',
    resolution: 'the gallery opens beautifully and the students feel proud',
    mood: 'creative, bright, collaborative',
    avoid: ['microphone', 'song', 'sports match', 'beach cleanup', 'cooking class'],
  },
];

const STORY_SIMILARITY_STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'along',
  'always',
  'around',
  'because',
  'before',
  'began',
  'being',
  'could',
  'didn',
  'does',
  'during',
  'each',
  'everyone',
  'everything',
  'felt',
  'finally',
  'first',
  'from',
  'girl',
  'have',
  'into',
  'just',
  'knew',
  'later',
  'looked',
  'made',
  'moment',
  'night',
  'over',
  'people',
  'room',
  'school',
  'she',
  'some',
  'something',
  'stage',
  'their',
  'there',
  'they',
  'thing',
  'through',
  'time',
  'very',
  'when',
  'with',
  'would',
]);

function hashWordsForStorySeed(words: string[]) {
  return words.join('|').split('').reduce((total, char, index) => total + char.charCodeAt(0) * (index + 1), 0);
}

function summarizeStoryForPrompt(text: string) {
  return text
    .replace(/\[blank_\d+\]/g, '___')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function pickStoryBlueprint(
  chunk: LearningData["words"],
  articleIndex: number,
  existingArticles: LearningData["articles"],
) {
  const existingSummaries = existingArticles.map((article) => summarizeStoryForPrompt(article.text).toLowerCase());
  const startIndex = (hashWordsForStorySeed(chunk.map((word) => word.word)) + articleIndex * 5) % STORY_BLUEPRINTS.length;

  for (let offset = 0; offset < STORY_BLUEPRINTS.length; offset += 1) {
    const blueprint = STORY_BLUEPRINTS[(startIndex + offset) % STORY_BLUEPRINTS.length];
    const hasConflict = existingSummaries.some((summary) => blueprint.avoid.some((keyword) => summary.includes(keyword)));
    if (!hasConflict) return blueprint;
  }

  return STORY_BLUEPRINTS[startIndex];
}

function getComparableStoryWords(text: string) {
  return text
    .replace(/\[blank_\d+\]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4)
    .filter((word) => !STORY_SIMILARITY_STOPWORDS.has(word));
}

function getStoryOpeningSignature(text: string) {
  return text
    .replace(/\[blank_\d+\]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 14)
    .join(' ');
}

function looksTooSimilarToExistingStories(
  candidateText: string,
  existingArticles: LearningData["articles"],
) {
  const candidateOpening = getStoryOpeningSignature(candidateText);
  const candidateWords = new Set(getComparableStoryWords(candidateText));

  for (const article of existingArticles) {
    const existingOpening = getStoryOpeningSignature(article.text);
    if (candidateOpening && candidateOpening === existingOpening) {
      return true;
    }

    const existingWords = new Set(getComparableStoryWords(article.text));
    const sharedWords = Array.from(candidateWords).filter((word) => existingWords.has(word));
    const overlapRatio = sharedWords.length / Math.max(1, Math.min(candidateWords.size, existingWords.size));

    if (sharedWords.length >= 8 && overlapRatio >= 0.58) {
      return true;
    }
  }

  return false;
}

function getStorySentenceCountGuidance(blankCount: number) {
  if (blankCount <= 4) return 'about 4 to 5 sentences total';
  if (blankCount <= 6) return 'about 5 to 6 sentences total';
  if (blankCount <= 8) return 'about 6 to 8 sentences total';
  return 'about 8 to 10 sentences total';
}

function buildExpectedArticleFromWords(
  chunk: LearningData["words"],
  allWords: LearningData["words"],
  articleIndex: number,
): LearningData["articles"][number] {
  const blanks = chunk.map((word, index) => ({
    id: `blank_${index}`,
    answer: word.word,
    explanation: buildContextualBlankExplanation(word.word, word.definition),
  }));
  const distractors = allWords
    .filter((candidate) => !chunk.some((item) => item.word === candidate.word))
    .slice(articleIndex * 2, articleIndex * 2 + 2)
    .map((word) => word.word);

  return {
    text: '',
    blanks,
    distractors:
      distractors.length >= 2
        ? distractors.slice(0, 2)
        : allWords
            .filter((candidate) => !blanks.some((blank) => blank.answer === candidate.word))
            .map((word) => word.word)
            .filter((word) => !distractors.includes(word))
            .slice(0, Math.max(0, 2 - distractors.length))
            .concat(distractors)
            .slice(0, 2),
  };
}

function normalizeBlankMarkers(text: string, expectedBlanks: LearningData["articles"][number]["blanks"]) {
  const expectedIds = new Set(expectedBlanks.map((blank) => blank.id));
  const markerMap = new Map<string, string>();
  const usedIds = new Set<string>();
  const assignedUnexpectedIds = new Set<string>();
  let hasUnexpectedMarker = false;

  const normalizedText = text.replace(/\[(blank_\d+)\]/g, (_match, marker: string) => {
    if (expectedIds.has(marker)) {
      usedIds.add(marker);
      return `[${marker}]`;
    }

    if (!markerMap.has(marker)) {
      const expectedBlank = expectedBlanks.find((blank) => !usedIds.has(blank.id) && !assignedUnexpectedIds.has(blank.id));
      if (!expectedBlank) {
        hasUnexpectedMarker = true;
        markerMap.set(marker, marker);
      } else {
        markerMap.set(marker, expectedBlank.id);
        assignedUnexpectedIds.add(expectedBlank.id);
        usedIds.add(expectedBlank.id);
      }
    }

    return `[${markerMap.get(marker)}]`;
  });

  return {
    text: normalizedText,
    usedIds,
    hasUnexpectedMarker,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fillMissingBlankMarkersFromAnswerWords(
  text: string,
  expectedBlanks: LearningData["articles"][number]["blanks"],
  usedIds: Set<string>,
) {
  let patchedText = text;
  const patchedIds = new Set<string>();

  for (const blank of expectedBlanks) {
    if (usedIds.has(blank.id)) continue;

    const escapedAnswer = escapeRegExp(blank.answer.trim());
    if (!escapedAnswer) continue;

    const answerPattern = new RegExp(`(^|[^a-z0-9\\]])(${escapedAnswer})(?=$|[^a-z0-9\\[])`, 'i');
    if (!answerPattern.test(patchedText)) continue;

    patchedText = patchedText.replace(answerPattern, (_match, prefix: string) => `${prefix}[${blank.id}]`);
    patchedIds.add(blank.id);
  }

  return {
    text: patchedText,
    patchedIds,
  };
}

function getBlankIdsInAppearanceOrder(text: string) {
  const seen = new Set<string>();
  const order: string[] = [];

  for (const match of text.matchAll(/\[(blank_\d+)\]/g)) {
    const blankId = match[1];
    if (seen.has(blankId)) continue;
    seen.add(blankId);
    order.push(blankId);
  }

  return order;
}

function canonicalizeArticleBlankOrder(
  text: string,
  blanks: LearningData["articles"][number]["blanks"],
) {
  const order = getBlankIdsInAppearanceOrder(text);
  const blankById = new Map(blanks.map((blank) => [blank.id, blank]));
  const canonicalIdMap = new Map<string, string>();

  order.forEach((blankId, index) => {
    canonicalIdMap.set(blankId, `blank_${index}`);
  });

  const canonicalText = text.replace(/\[(blank_\d+)\]/g, (_match, blankId: string) => {
    return `[${canonicalIdMap.get(blankId) || blankId}]`;
  });

  const canonicalBlanks = order
    .map((blankId, index) => {
      const original = blankById.get(blankId);
      if (!original) return null;

      return {
        ...original,
        id: `blank_${index}`,
      };
    })
    .filter(Boolean) as LearningData["articles"][number]["blanks"];

  return {
    text: canonicalText,
    blanks: canonicalBlanks,
  };
}

type StoryNormalizationResult = {
  article: LearningData["articles"][number] | null;
  reason?: string;
};

function normalizeArticleCandidate(
  article: any,
  expectedArticle: LearningData["articles"][number],
  existingArticles: LearningData["articles"] = [],
): StoryNormalizationResult {
  const normalized = {
    text: String(article?.text ?? '').trim(),
    blanks: Array.isArray(article?.blanks)
      ? article.blanks.map((blank: any, index: number) => ({
          id: String(blank?.id ?? `blank_${index}`).trim(),
          answer: String(blank?.answer ?? '').trim(),
          explanation: String(blank?.explanation ?? '').trim() || 'This word fits this part of the story best.',
        }))
      : [],
    distractors: Array.isArray(article?.distractors)
      ? article.distractors.map((word: any) => String(word ?? '').trim()).filter(Boolean).slice(0, 2)
      : [],
  };

  const reject = (reason: string, details?: unknown): StoryNormalizationResult => {
    console.warn(`[story validation] rejected: ${reason}`, details);
    return { article: null, reason };
  };

  if (!normalized.text) {
    return reject('empty text', { article });
  }
  if (normalized.blanks.length !== expectedArticle.blanks.length) {
    console.warn('[story validation] rejected: blank count mismatch', {
      expected: expectedArticle.blanks.length,
      got: normalized.blanks.length,
      article,
    });
  }
  if (looksLikeDefinitionDrill(normalized.text)) {
    return reject('looks like definition drill', { text: normalized.text });
  }
  if (looksLikeWeakFallbackStory(normalized.text)) {
    return reject('looks like weak fallback story', { text: normalized.text });
  }

  let { text, usedIds, hasUnexpectedMarker } = normalizeBlankMarkers(normalized.text, expectedArticle.blanks);
  if (usedIds.size < expectedArticle.blanks.length) {
    const patched = fillMissingBlankMarkersFromAnswerWords(text, expectedArticle.blanks, usedIds);
    if (patched.patchedIds.size > 0) {
      text = patched.text;
      usedIds = new Set([...usedIds, ...patched.patchedIds]);
    }
  }
  if (usedIds.size === 0) {
    return reject('no playable blanks in story text', { text: normalized.text });
  }
  if (usedIds.size !== expectedArticle.blanks.length) {
    return reject('story did not use every selected blank', {
      expected: expectedArticle.blanks.length,
      got: usedIds.size,
      text,
    });
  }
  if (hasUnexpectedMarker) {
    return reject('too many blank markers in story text', { text });
  }
  if (existingArticles.length > 0 && looksTooSimilarToExistingStories(text, existingArticles)) {
    return reject('story too similar to an existing article', { text });
  }

  const explanationByAnswer = new Map<string, string>(
    normalized.blanks
      .filter((blank) => blank.answer)
      .map((blank) => [blank.answer.toLowerCase(), blank.explanation]),
  );
  const explanationById = new Map<string, string>(
    normalized.blanks
      .filter((blank) => blank.id)
      .map((blank) => [blank.id.toLowerCase(), blank.explanation]),
  );

  const canonical = canonicalizeArticleBlankOrder(text, expectedArticle.blanks);

  return {
    reason: undefined,
    article: {
    ...normalized,
    text: canonical.text,
    blanks: canonical.blanks.map((blank) => {
      const modelExplanation =
        explanationById.get(blank.id.toLowerCase()) ||
        explanationByAnswer.get(blank.answer.toLowerCase()) ||
        '';

      return {
        ...blank,
        explanation:
          modelExplanation && !looksLikeDefinitionOnlyExplanation(modelExplanation)
            ? modelExplanation
            : blank.explanation || buildContextualBlankExplanation(blank.answer, ''),
      };
    }),
    distractors: normalized.distractors.length === 2 ? normalized.distractors : expectedArticle.distractors,
    },
  };
}

function buildStoryGenerationPrompt(
  articleIndex: number,
  blankSpecs: string,
  distractorWords: string[],
  attempt: number,
  blueprint: StoryBlueprint,
  existingArticles: LearningData["articles"],
  blankCount: number,
  lastFailureReason?: string,
) {
  const previousStoryNote =
    existingArticles.length === 0
      ? ''
      : `

Stories already generated today. The new story must feel clearly different from them:
${existingArticles
  .map((article, index) => `- Story ${index + 1}: ${summarizeStoryForPrompt(article.text)}`)
  .join('\n')}

Hard anti-repetition rules:
- Do not reuse the same opening pattern as an earlier story.
- Do not reuse the same setting, event type, or climax.
- Change at least 4 of these 5 dimensions: place, main task, supporting characters, emotional arc, ending image.
`;
  const retryNote =
    attempt === 1
      ? ''
      : `

Extra retry rules for this attempt:
- Your last answer was rejected for this reason: ${lastFailureReason || 'it did not read like one real connected story'}.
- Do NOT write isolated sentence drills.
- Make the passage flow from beginning to middle to ending.
- Each blank must fit naturally into one ongoing scene.
- Use simple, vivid events children can picture.
`;

  return `Return JSON in this exact shape:
{"index":${articleIndex},"text":"The girl felt [blank_0] as she stepped onto the stage, and the lights began to [blank_1] above her.","blanks":[{"id":"blank_0","answer":"brave","explanation":"brave fits here because she is overcoming fear in this moment."},{"id":"blank_1","answer":"sparkle","explanation":"sparkle fits here because the sentence is describing how the lights shine."}],"distractors":["quiet","heavy"]}

Rules:
- Generate exactly one article with index ${articleIndex}.
- The article must be one connected story or passage.
- In the "text" field, replace each vocabulary word with its placeholder [blank_0], [blank_1], etc. Do NOT write the actual word in the text — use only the [blank_N] marker.
- Keep blank ids and answers exactly as specified.
- Each blank explanation must explain why that word fits that sentence or moment in the story.
- Do not write dictionary-only explanations like "X means...".
- Do not use generic filler like "appears in this study set".
- Keep distractors to exactly these 2 strings if possible: ${distractorWords.join(', ')}
- Use this specific story blueprint:
  - Story label: ${blueprint.label}
  - Setting: ${blueprint.setting}
  - Main character(s): ${blueprint.lead}
  - Main challenge: ${blueprint.challenge}
  - Ending direction: ${blueprint.resolution}
  - Mood: ${blueprint.mood}
  - Avoid these motifs: ${blueprint.avoid.join(', ')}

Write one short coherent story for upper-elementary learners.
- The story must feel continuous, with setup, problem, and resolution.
- The story should sound like a real mini storybook passage, not a worksheet.
- Keep it compact: ${getStorySentenceCountGuidance(blankCount)}.
- It is okay to use one target word in most sentences and two target words in a few sentences when it still sounds natural.
- Make sure every target word is genuinely used in context, not just squeezed in unnaturally.
- You may place the blank placeholders in any natural order inside the story.
- Each placeholder must still stay tied to its assigned answer word.
${previousStoryNote}
${retryNote}
Use these exact blank assignments:
${blankSpecs}`;
}

async function generateStoryArticle(
  openai: OpenAI,
  chunk: LearningData["words"],
  allWords: LearningData["words"],
  articleIndex: number,
  expectedArticle: LearningData["articles"][number] = buildExpectedArticleFromWords(chunk, allWords, articleIndex),
  existingArticles: LearningData["articles"] = [],
): Promise<LearningData["articles"][number]> {
  const blankSpecs = chunk
    .map(
      (word, index) =>
        `${expectedArticle.blanks[index]?.id || `blank_${index}`} => word=${word.word}; partOfSpeech=${word.partOfSpeech}; definition=${word.definition}; example=${word.exampleSentence}`,
    )
    .join('\n');

  const distractorWords = expectedArticle.distractors;
  let acceptedArticle: LearningData["articles"][number] | null = null;
  let lastFailureReason: string | undefined;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const blueprint = pickStoryBlueprint(chunk, articleIndex + attempt - 1, existingArticles);
    const response = await withProviderRetries(
      () =>
        openai.chat.completions.create({
          model: MOONSHOT_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You write one short coherent children's story for vocabulary practice. Return strictly valid JSON only. The passage must read like one connected story, not unrelated sentences.",
            },
            {
              role: "user",
              content: buildStoryGenerationPrompt(
                articleIndex,
                blankSpecs,
                distractorWords,
                attempt,
                blueprint,
                existingArticles,
                chunk.length,
                lastFailureReason,
              ),
            },
          ],
          max_tokens: 1500,
          temperature: 0.6,
          response_format: { type: "json_object" },
        }),
      `Story ${articleIndex + 1} generation`,
      2,
    );

    const content = extractJsonObject(response.choices[0].message.content || "{}");
    let parsed: {
      index?: number;
      text?: string;
      blanks?: Array<{ id?: string; answer?: string; explanation?: string }>;
      distractors?: string[];
    };

    try {
      parsed = JSON.parse(content);
    } catch {
      if (attempt === 3) {
        throw new Error(`Story ${articleIndex + 1} JSON parsing failed.`);
      }
      continue;
    }

    const normalized = normalizeArticleCandidate(parsed, expectedArticle, existingArticles);
    if (normalized.article) {
      acceptedArticle = normalized.article;
      break;
    }

    lastFailureReason = normalized.reason;
  }

  if (!acceptedArticle) {
    throw new Error(
      `Story ${articleIndex + 1} generation did not return a valid coherent passage${lastFailureReason ? ` (${lastFailureReason})` : ''}.`,
    );
  }

  return acceptedArticle;
}

async function generateStoryArticles(
  openai: OpenAI,
  words: LearningData["words"],
  articleCount: number,
): Promise<LearningData["articles"]> {
  const safeArticleCount = Math.max(1, articleCount);
  const chunks = buildArticleChunks(words, safeArticleCount);
  const generatedArticles: LearningData["articles"] = [];

  for (const [articleIndex, chunk] of chunks.entries()) {
      generatedArticles.push(await generateStoryArticle(openai, chunk, words, articleIndex, undefined, generatedArticles));
  }

  return generatedArticles;
}

function getFunctionBaseURL(functionName: 'moonshot' | 'minimax') {
  if (typeof window === 'undefined') {
    return `http://localhost:47821/api/${functionName}/v1`;
  }

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `http://localhost:47821/api/${functionName}/v1`;
  }

  return `${window.location.origin}/api/${functionName}/v1`;
}

function createMoonshotClient() {
  return new OpenAI({
    baseURL: getFunctionBaseURL('moonshot'),
    apiKey: 'server-managed',
    dangerouslyAllowBrowser: true,
  });
}

function createMiniMaxClient() {
  return new OpenAI({
    baseURL: getFunctionBaseURL('minimax'),
    apiKey: 'server-managed',
    dangerouslyAllowBrowser: true,
  });
}

function normalizeLearningData(input: any, requestedWords: ParsedWordInput[], articleCount: number): LearningData {
  const words = Array.isArray(input?.words) ? input.words : [];
  const articles = Array.isArray(input?.articles) ? input.articles : [];
  const sentenceClozeQuestions = Array.isArray(input?.sentenceClozeQuestions) ? input.sentenceClozeQuestions : [];
  const vocabularyInContextQuestions = Array.isArray(input?.vocabularyInContextQuestions)
    ? input.vocabularyInContextQuestions
    : [];

  const normalizedWords: LearningData["words"] = words
      .map((word: any) => {
        const rawWord = String(word?.word ?? '').trim();
        const splitInput = parseWordInputs(rawWord)[0];
        const cleanedWord = splitInput?.word || rawWord;
        const hintedDefinition = splitInput?.providedDefinition;

        return {
          word: cleanedWord,
          synonym:
            String(word?.synonym ?? '').trim() ||
            fallbackSynonym(cleanedWord, String(word?.definition ?? '').trim() || hintedDefinition || ''),
          partOfSpeech: String(word?.partOfSpeech ?? '').trim() || 'word',
          definition: String(word?.definition ?? '').trim() || hintedDefinition || 'Definition unavailable.',
          exampleSentence: ensurePlayableExample(
            cleanedWord,
            String(word?.definition ?? '').trim() || hintedDefinition || 'Definition unavailable.',
            String(word?.partOfSpeech ?? '').trim() || 'word',
            String(word?.exampleSentence ?? '').trim(),
          ),
          exampleSentenceWithBlank:
            replaceWordWithBlank(
              ensurePlayableExample(
                cleanedWord,
                String(word?.definition ?? '').trim() || hintedDefinition || 'Definition unavailable.',
                String(word?.partOfSpeech ?? '').trim() || 'word',
                String(word?.exampleSentence ?? '').trim(),
              ),
              cleanedWord,
              '___',
            ),
        };
      })
      .filter((word: { word: string }) => word.word.length > 0);

  const normalizedWordMap = new Map(
    normalizedWords.map((word) => [word.word.toLowerCase(), word]),
  );

  const completedWords = requestedWords.map((requestedWord) => {
    const existing = normalizedWordMap.get(requestedWord.word.toLowerCase());
    if (existing) return existing;

    return {
      word: requestedWord.word,
      synonym: fallbackSynonym(requestedWord.word, requestedWord.providedDefinition || ''),
      partOfSpeech: 'word',
      definition: requestedWord.providedDefinition || `${requestedWord.word} is one of the target vocabulary words.`,
      exampleSentence: buildFallbackExample(
        requestedWord.word,
        requestedWord.providedDefinition || `${requestedWord.word} is one of the target vocabulary words.`,
        'word',
      ),
      exampleSentenceWithBlank: replaceWordWithBlank(
        buildFallbackExample(
          requestedWord.word,
          requestedWord.providedDefinition || `${requestedWord.word} is one of the target vocabulary words.`,
          'word',
        ),
        requestedWord.word,
        '___',
      ),
    };
  });

  const normalizedArticles: LearningData["articles"] = articles.map((article: any) => ({
      text: String(article?.text ?? '').trim(),
      blanks: Array.isArray(article?.blanks)
        ? article.blanks.map((blank: any, index: number) => ({
            id: String(blank?.id ?? `blank_${index}`),
            answer: String(blank?.answer ?? '').trim(),
            explanation: (() => {
              const answer = String(blank?.answer ?? '').trim();
              const rawExplanation = String(blank?.explanation ?? '').trim();
              const matchedWord = normalizedWordMap.get(answer.toLowerCase());

              if (!rawExplanation || looksLikeDefinitionOnlyExplanation(rawExplanation)) {
                return buildContextualBlankExplanation(answer, matchedWord?.definition || '');
              }

              return rawExplanation;
            })(),
          }))
        : [],
      distractors: Array.isArray(article?.distractors)
        ? article.distractors.map((word: any) => String(word ?? '').trim()).filter(Boolean)
        : [],
    }));

  const completedArticles =
    articleCount > 0
      ? buildFallbackArticles(completedWords, articleCount).map((fallbackArticle, index) => {
          const validArticles = normalizedArticles.filter(
            (article) =>
              article.text.length > 0 &&
              article.blanks.length > 0 &&
              !looksLikeDefinitionDrill(article.text) &&
              !looksLikeWeakFallbackStory(article.text),
          );
          return validArticles[index] ?? fallbackArticle;
        })
      : [];

  const { sentenceWords, contextWords } = partitionWordsForExamQuestions(completedWords);

  return {
    words: completedWords,
    articles: completedArticles,
    sentenceClozeQuestions: normalizeSentenceClozeQuestions(sentenceClozeQuestions, sentenceWords, completedWords),
    vocabularyInContextQuestions: normalizeVocabularyInContextQuestions(
      vocabularyInContextQuestions,
      contextWords,
      completedWords,
    ),
  };
}

async function repairMalformedJsonObject<T>(
  openai: OpenAI,
  malformedContent: string,
  model: string = MOONSHOT_MODEL,
): Promise<T> {
  const repairResponse = await withProviderRetries(
    () =>
      openai.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              "You repair malformed JSON. Return only one strictly valid JSON object. Keep the original meaning and schema. Do not add markdown fences.",
          },
          {
            role: "user",
            content: `Repair this malformed JSON so it becomes strictly valid JSON:\n\n${malformedContent}`,
          },
        ],
      }),
    'JSON repair',
  );

  const repairedContent = extractJsonObject(repairResponse.choices[0].message.content || "{}");
  return JSON.parse(repairedContent) as T;
}

async function repairSynonyms(
  openai: OpenAI,
  words: Array<{ word: string; definition: string; synonym: string }>,
): Promise<Record<string, string>> {
  const response = await withProviderRetries(
    () =>
      openai.chat.completions.create({
        model: MOONSHOT_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You create child-friendly synonyms. Return strictly valid JSON only. Each synonym must be a real synonym or near-synonym, not a definition sentence. Use one or two words only. For phrasal verbs, prefer a natural verb or short verb phrase such as appear, arrive, continue, discover, remove, reject, accept, delay, or escape.",
          },
          {
            role: "user",
            content: `Return JSON in this exact shape: {"items":[{"word":"...","synonym":"..."}]}

Rules:
- Each synonym must be a REAL, common English word that a 10-year-old would know.
- The synonym must have the SAME meaning as the original word.
- Use exactly one word when possible, at most two words.
- Do NOT copy the definition.
- Do NOT invent words or use obscure/rare words.
- Do NOT append words like "match", "alike", "related".
- If the word is a phrasal verb, give a natural single-word equivalent (e.g., "turn up" → "appear", "call on" → "visit", "give in" → "surrender").
- If the word is an adjective, the synonym must also be an adjective.
- If the word is a verb, the synonym must also be a verb.

Examples of GOOD synonyms:
- brave → courageous
- happy → joyful
- walk → stroll
- big → large
- scared → afraid
- quickly → fast
- stubborn → obstinate

Examples of BAD synonyms (never do this):
- brave → "showing courage" (this is a definition, not a synonym)
- happy → "happymatch" (invented word)
- walk → "movement" (wrong part of speech)

Words to repair:
${words
          .map((item) => `word=${item.word}; partOfSpeech=guess from definition; definition=${item.definition}`)
          .join('\n')}`,
          },
        ],
        max_tokens: 1800,
      }),
    'Synonym repair',
  );

  const content = extractJsonObject(response.choices[0].message.content || "{}");
  const parsed = JSON.parse(content) as { items?: Array<{ word?: string; synonym?: string }> };

  return Object.fromEntries(
    (parsed.items || [])
      .map((item) => [String(item.word || '').trim().toLowerCase(), String(item.synonym || '').trim()])
      .filter(([word, synonym]) => word && synonym)
      .filter(([, synonym]) => {
        // Reject synonyms that are clearly bad
        if (synonym.split(/\s+/).length > 3) return false;
        if (/[.:;!?]/.test(synonym)) return false;
        if (synonym.length > 25) return false;
        if (/match$|alike$|related$/i.test(synonym)) return false;
        return true;
      }),
  );
}

async function ensurePlayableSynonyms(openai: OpenAI, data: LearningData): Promise<LearningData> {
  const repairTargets = data.words.filter((word) => looksLikeDefinitionSynonym(word.synonym, word.definition));

  if (repairTargets.length === 0) return data;

  let repairedMap: Record<string, string> = {};
  for (const chunk of chunkArray(repairTargets, 4)) {
    try {
      const repairedChunk = await repairSynonyms(openai, chunk);
      repairedMap = {
        ...repairedMap,
        ...repairedChunk,
      };
    } catch (error) {
      console.error('Synonym repair failed for one chunk, using fallback synonyms.', error);
    }
  }

  const usedSynonyms = new Set<string>();

  return {
    ...data,
    words: data.words.map((word) => {
      const repaired = repairedMap[word.word.toLowerCase()];
      const nextSynonym =
        repaired && !looksLikeDefinitionSynonym(repaired, word.definition)
          ? repaired
          : looksLikeDefinitionSynonym(word.synonym, word.definition)
            ? fallbackSynonym(word.word, word.definition, usedSynonyms)
            : word.synonym;

      const dedupedSynonym = usedSynonyms.has(normalizePhrase(nextSynonym))
        ? fallbackSynonym(word.word, word.definition, usedSynonyms)
        : nextSynonym;

      usedSynonyms.add(normalizePhrase(dedupedSynonym));

      return {
        ...word,
        synonym: dedupedSynonym,
      };
    }),
  };
}

async function ensureCoherentArticles(openai: OpenAI, data: LearningData, articleCount: number): Promise<LearningData> {
  try {
    const generatedArticles = await generateStoryArticles(openai, data.words, articleCount);

    return {
      ...data,
      articles: generatedArticles,
    };
  } catch (error) {
    if (isTimeoutLikeError(error)) {
      throw new Error('Story generation timed out. Please try again with fewer stories or a smaller word batch.');
    }
    throw error;
  }
}

function isBadExample(sentence: string, word: string): boolean {
  const s = sentence.toLowerCase();
  return (
    !sentence.trim() ||
    s.includes('means to') ||
    s.includes('means ') ||
    s.includes('is one of the vocabulary') ||
    s.includes('appears in this study set') ||
    s.includes('if something is ' + word.toLowerCase()) ||
    s.includes('the word "' + word.toLowerCase() + '"')
  );
}

async function repairMissingExamples(openai: OpenAI, data: LearningData): Promise<LearningData> {
  const badWords = data.words.filter((w) => isBadExample(w.exampleSentence, w.word));
  if (badWords.length === 0) return data;
  const exampleMap = new Map<string, { sentence: string; blank: string }>();

  for (const chunk of chunkArray(badWords, 4)) {
    const wordSpecs = chunk
      .map((w) => `word=${w.word}; partOfSpeech=${w.partOfSpeech}; definition=${w.definition}`)
      .join('\n');

    try {
      const response = await withProviderRetries(
        () =>
          openai.chat.completions.create({
            model: MOONSHOT_MODEL,
            messages: [
              {
                role: "system",
                content: "You generate natural English example sentences for vocabulary words. Return strictly valid JSON only.",
              },
              {
                role: "user",
                content: `Generate one natural example sentence for each word below. Each sentence must show the word used correctly in a real-life situation. Do NOT write definitions or meta-sentences.

Return JSON: {"examples":[{"word":"...","exampleSentence":"...","exampleSentenceWithBlank":"..."}]}

${wordSpecs}`,
              },
            ],
            max_tokens: 2200,
          }),
        'Example repair',
      );

      const content = extractJsonObject(response.choices[0].message.content || "{}");
      const parsed = JSON.parse(content) as {
        examples?: Array<{ word?: string; exampleSentence?: string; exampleSentenceWithBlank?: string }>;
      };

      for (const item of parsed.examples || []) {
        const w = String(item.word || '').trim().toLowerCase();
        const s = String(item.exampleSentence || '').trim();
        const b = String(item.exampleSentenceWithBlank || '').trim();
        if (w && s && !isBadExample(s, item.word || '')) {
          exampleMap.set(w, { sentence: s, blank: b || replaceWordWithBlank(s, item.word || '', '___') });
        }
      }
    } catch (error) {
      console.error('Example repair failed for one chunk, keeping fallback examples.', error);
    }
  }

  return {
    ...data,
    words: data.words.map((w) => {
      const repair = exampleMap.get(w.word.toLowerCase());
      if (repair && isBadExample(w.exampleSentence, w.word)) {
        return { ...w, exampleSentence: repair.sentence, exampleSentenceWithBlank: repair.blank };
      }
      return w;
    }),
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildMaterialsPrompt(parsedWords: ParsedWordInput[]): string {
  const wordList = parsedWords.map((item) => item.word);

  return `
  I am building a vocabulary learning app. Please generate learning materials for the following words:
  ${wordList.join(', ')}

  If a short definition hint is provided, use it as a guide:
  ${parsedWords.map((item) => `${item.word}${item.providedDefinition ? ` = ${item.providedDefinition}` : ''}`).join('\n')}

  Return a JSON object with this exact structure:
  {
    "words": [
      {
        "word": "the word itself",
        "synonym": "one simple synonym or near-synonym phrase that a child can match",
        "partOfSpeech": "part of speech (e.g., n., v., adj.)",
        "definition": "English definition",
        "exampleSentence": "An example sentence using the word.",
        "exampleSentenceWithBlank": "The same example sentence but with the word replaced by '___'."
      }
    ]
  }

  CRITICAL RULES FOR EXAMPLE SENTENCES:
  - Every example sentence MUST be unique. Do NOT reuse sentence templates or patterns across different words.
  - Each sentence must show the word used naturally in a real-life situation a child can picture.
  - The word must be used grammatically correctly in the sentence.
  - Do NOT write meta-sentences like "X became the perfect word for that moment" or "The word X describes how...".
  - Do NOT write template sentences like "When the gate opened, the children began to X toward the path".
  - Use varied settings: school, home, park, kitchen, sports, weather, animals, friends, family, etc.
  - BAD examples (never do this):
    "Soon, rashly became the perfect word for that magical little moment."
    "When the gate opened, the children began to called on toward the glowing garden path."
    "The word brave appeared in the story."
  - GOOD examples:
    "She rashly agreed to the dare without checking how deep the water was."
    "My aunt called on us every Sunday for tea and biscuits."
    "The brave firefighter rushed into the burning building to save the cat."

  CRITICAL RULES FOR SYNONYMS:
  - The "synonym" field must be a REAL, common English word (one a 10-year-old would know).
  - It must have the SAME meaning and SAME part of speech as the original word.
  - Use exactly one word when possible, at most two words.
  - Do NOT write a definition or explanation as the synonym.
  - Do NOT invent words or combine words unnaturally.
  - For phrasal verbs, use a natural single-word equivalent:
    "turn up" → "appear", "call on" → "visit", "give in" → "surrender", "hold back" → "delay"
  - GOOD synonyms: brave→courageous, happy→joyful, scared→afraid, big→large, walk→stroll
  - BAD synonyms: brave→"showing courage", happy→"happymatch", walk→"movement"

  IMPORTANT JSON RULES:
  Return only raw JSON.
  Every string value must be valid JSON.
  Do not include unescaped double quotes inside any string value.
  Do not wrap example sentences in extra quotation marks.
  `;
}

function wordPartitionHash(input: string) {
  return Array.from(input.toLowerCase()).reduce((total, character, index) => {
    return total + character.charCodeAt(0) * (index + 1);
  }, 0);
}

export function createExamQuestionPlan(words: LearningData["words"]) {
  const orderedWords = [...words].sort((left, right) => {
    const leftHash = wordPartitionHash(left.word);
    const rightHash = wordPartitionHash(right.word);
    if (leftHash !== rightHash) return leftHash - rightHash;
    return left.word.localeCompare(right.word);
  });
  const sentenceCount = Math.min(10, Math.ceil(words.length / 2));

  return {
    sentenceWords: orderedWords.slice(0, sentenceCount),
    contextWords: orderedWords.slice(
      sentenceCount,
      sentenceCount + Math.min(10, orderedWords.length - sentenceCount),
    ),
  };
}

function partitionWordsForExamQuestions(words: LearningData["words"]) {
  return createExamQuestionPlan(words);
}

function buildSentenceClozePrompt(words: LearningData["words"]) {
  return `Create Sentence Cloze multiple-choice questions in Singapore primary exam style.

Return JSON in this exact shape:
{
  "questions": [
    {
      "id": "sc-1",
      "targetWord": "hesitant",
      "sentence": "Mia felt ___ before answering the question because she was unsure of herself.",
      "options": ["hesitant", "cheerful", "tidy", "gentle"],
      "answer": "hesitant",
      "explanation": "hesitant fits because the sentence shows Mia was unsure and not ready to answer quickly."
    }
  ]
}

Rules:
- Generate exactly ${words.length} questions, one per target word below.
- Use each target word exactly once as the correct answer.
- These must be NEW exam-style sentences. Do NOT reuse or closely paraphrase the existing example sentence.
- Each sentence must contain exactly one blank written as ___.
- Each question must have exactly 4 single-word or short-phrase options.
- The 3 distractors must be plausible and similar in part of speech or category.
- The sentence must sound natural, like a school exam question in Singapore.
- Vary settings across school, home, community, nature, food, travel, sports, and everyday life.
- Avoid repeating the same situation across many questions.
- Explanations must say why the answer fits this sentence, not just give a dictionary definition.
- Return raw JSON only.

Target words:
${words
  .map(
    (word, index) =>
      `${index + 1}. word=${word.word}; partOfSpeech=${word.partOfSpeech}; definition=${word.definition}; doNotReuseExample=${word.exampleSentence}`,
  )
  .join('\n')}`;
}

function buildVocabularyInContextPrompt(words: LearningData["words"]) {
  return `Create Vocabulary in Context multiple-choice questions in Singapore primary exam style.

Return JSON in this exact shape:
{
  "questions": [
    {
      "id": "vic-1",
      "targetWord": "hesitant",
      "passage": "Mia stared at the diving board for a long time. She took one small step forward, then stopped again. Her coach could see she was hesitant about jumping into the pool.",
      "question": "In the passage, what does \"hesitant\" most nearly mean?",
      "options": ["unsure", "joyful", "careless", "untidy"],
      "answer": "unsure",
      "explanation": "hesitant means unsure here because Mia keeps stopping instead of jumping straight away."
    }
  ]
}

Rules:
- Generate exactly ${words.length} questions, one per target word below.
- Use each target word exactly once inside its own passage.
- Passages must be NEW and must not reuse or closely paraphrase the existing example sentence.
- Each passage should be 2 to 4 sentences and feel like a short exam extract.
- The question should ask for the closest meaning or best replacement in context.
- Each question must have exactly 4 short answer options.
- The correct answer should be the meaning that best matches the passage context, not the word itself.
- Distractors must be plausible and exam-like.
- Explanations must focus on the passage context.
- Return raw JSON only.

Target words:
${words
  .map(
    (word, index) =>
      `${index + 1}. word=${word.word}; partOfSpeech=${word.partOfSpeech}; definition=${word.definition}; synonym=${word.synonym}; doNotReuseExample=${word.exampleSentence}`,
  )
  .join('\n')}`;
}

function normalizeSentenceClozeQuestions(
  rawQuestions: any[],
  targetWords: LearningData["words"],
  allWords: LearningData["words"],
): SentenceClozeQuestion[] {
  const targetMap = new Map(targetWords.map((word) => [getWordKey(word.word), word]));
  const orderedTargets = targetWords.map((word) => getWordKey(word.word));
  const normalizedQuestions = new Map<string, SentenceClozeQuestion>();

  for (const question of rawQuestions) {
    const answerCandidate = normalizeOptionText(question?.answer || question?.targetWord);
    const targetKey = getWordKey(answerCandidate);
    const targetWord = targetMap.get(targetKey);
    if (!targetWord) continue;

    const sentence = String(question?.sentence || '').trim();
    const sentenceWithBlank = sentence.includes('___')
      ? sentence
      : replaceWordWithBlank(sentence, targetWord.word, '___');

    if (!sentenceWithBlank.includes('___')) continue;

    const options = ensureChoiceOptions(
      targetWord.word,
      Array.isArray(question?.options) ? question.options : [],
      allWords.filter((word) => word.word.toLowerCase() !== targetKey).map((word) => word.word),
    );

    normalizedQuestions.set(targetKey, {
      id: String(question?.id || `sentence-cloze-${targetWord.word}`).trim(),
      targetWord: targetWord.word,
      sentence: sentenceWithBlank,
      options,
      answer: targetWord.word,
      explanation:
        String(question?.explanation || '').trim() ||
        `${targetWord.word} is the best fit because it matches what is happening in this sentence.`,
    });
  }

  return shuffleWords(
    orderedTargets
    .map((targetKey) => normalizedQuestions.get(targetKey))
    .filter((question): question is SentenceClozeQuestion => Boolean(question)),
  );
}

function normalizeVocabularyInContextQuestions(
  rawQuestions: any[],
  targetWords: LearningData["words"],
  allWords: LearningData["words"],
): VocabularyInContextQuestion[] {
  const targetMap = new Map(targetWords.map((word) => [getWordKey(word.word), word]));
  const orderedTargets = targetWords.map((word) => getWordKey(word.word));
  const normalizedQuestions = new Map<string, VocabularyInContextQuestion>();

  for (const question of rawQuestions) {
    const targetWordLabel = normalizeOptionText(question?.targetWord);
    const targetKey = getWordKey(targetWordLabel);
    const targetWord = targetMap.get(targetKey);
    if (!targetWord) continue;

    const passage = String(question?.passage || '').trim();
    if (!passage || !textContainsTargetWord(passage, targetWord.word)) {
      continue;
    }

    const answer = normalizeOptionText(question?.answer || conciseMeaningChoice(targetWord.synonym || targetWord.definition));
    const options = ensureChoiceOptions(
      answer,
      Array.isArray(question?.options) ? question.options : [],
      allWords
        .filter((word) => getWordKey(word.word) !== targetKey)
        .flatMap((word) => [conciseMeaningChoice(word.synonym), conciseMeaningChoice(word.definition)]),
    );

    normalizedQuestions.set(targetKey, {
      id: String(question?.id || `vocabulary-in-context-${targetWord.word}`).trim(),
      targetWord: targetWord.word,
      passage,
      question:
        String(question?.question || '').trim() ||
        `In the passage, what does "${targetWord.word}" most nearly mean?`,
      options,
      answer,
      explanation:
        String(question?.explanation || '').trim() ||
        `${answer} is the best answer because it matches how ${targetWord.word} is used in this passage.`,
    });
  }

  return shuffleWords(
    orderedTargets
    .map((targetKey) => normalizedQuestions.get(targetKey))
    .filter((question): question is VocabularyInContextQuestion => Boolean(question)),
  );
}

function assertQuestionCoverage(
  label: string,
  questions: Array<{ targetWord: string }>,
  targetWords: LearningData["words"],
) {
  const missing = targetWords
    .map((word) => word.word)
    .filter((word) => !questions.some((question) => question.targetWord.toLowerCase() === word.toLowerCase()));

  if (missing.length > 0) {
    throw new Error(`${label} generation missed these words: ${missing.join(', ')}`);
  }
}

function getMissingQuestionWords(
  questions: Array<{ targetWord: string }>,
  targetWords: LearningData["words"],
) {
  return targetWords.filter(
    (word) => !questions.some((question) => question.targetWord.toLowerCase() === word.word.toLowerCase()),
  );
}

function mergeQuestionsByTarget<T extends { targetWord: string }>(
  targetWords: LearningData["words"],
  existing: T[],
  additions: T[],
) {
  const merged = new Map<string, T>();

  for (const question of [...existing, ...additions]) {
    merged.set(question.targetWord.toLowerCase(), question);
  }

  return shuffleWords(
    targetWords
      .map((word) => merged.get(word.word.toLowerCase()))
      .filter((question): question is T => Boolean(question)),
  );
}

async function generateSentenceClozeQuestions(
  openai: OpenAI,
  words: LearningData["words"],
  allWords: LearningData["words"],
): Promise<SentenceClozeQuestion[]> {
  if (words.length === 0) return [];
  let combinedQuestions: SentenceClozeQuestion[] = [];
  let pendingWords = words;

  for (let attempt = 0; attempt < 3 && pendingWords.length > 0; attempt += 1) {
    const response = await withProviderRetries(
      () =>
        openai.chat.completions.create({
          model: MOONSHOT_MODEL,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You create high-quality Singapore-style vocabulary exam questions. Return strictly valid JSON only.',
            },
            { role: 'user', content: buildSentenceClozePrompt(pendingWords) },
          ],
          max_tokens: 4200,
        }),
      `Sentence Cloze generation${attempt > 0 ? ` retry ${attempt}` : ''}`,
      4,
    );

    const content = extractJsonObject(response.choices[0].message.content || '{}');
    let parsed: { questions?: any[] };

    try {
      parsed = JSON.parse(content) as { questions?: any[] };
    } catch (error) {
      console.error('Sentence Cloze parse failed, attempting repair.', error);
      parsed = await repairMalformedJsonObject<{ questions?: any[] }>(openai, content, MOONSHOT_MODEL);
    }

    const normalized = normalizeSentenceClozeQuestions(parsed.questions || [], pendingWords, allWords);
    combinedQuestions = mergeQuestionsByTarget(words, combinedQuestions, normalized);
    pendingWords = getMissingQuestionWords(combinedQuestions, words);
  }

  assertQuestionCoverage('Sentence Cloze', combinedQuestions, words);
  return combinedQuestions;
}

async function generateVocabularyInContextQuestions(
  openai: OpenAI,
  words: LearningData["words"],
  allWords: LearningData["words"],
): Promise<VocabularyInContextQuestion[]> {
  if (words.length === 0) return [];
  let combinedQuestions: VocabularyInContextQuestion[] = [];
  let pendingWords = words;

  for (let attempt = 0; attempt < 3 && pendingWords.length > 0; attempt += 1) {
    const response = await withProviderRetries(
      () =>
        openai.chat.completions.create({
          model: MOONSHOT_MODEL,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You create high-quality Singapore-style vocabulary-in-context questions. Return strictly valid JSON only.',
            },
            { role: 'user', content: buildVocabularyInContextPrompt(pendingWords) },
          ],
          max_tokens: 5200,
        }),
      `Vocabulary in Context generation${attempt > 0 ? ` retry ${attempt}` : ''}`,
      4,
    );

    const content = extractJsonObject(response.choices[0].message.content || '{}');
    let parsed: { questions?: any[] };

    try {
      parsed = JSON.parse(content) as { questions?: any[] };
    } catch (error) {
      console.error('Vocabulary in Context parse failed, attempting repair.', error);
      parsed = await repairMalformedJsonObject<{ questions?: any[] }>(openai, content, MOONSHOT_MODEL);
    }

    const normalized = normalizeVocabularyInContextQuestions(parsed.questions || [], pendingWords, allWords);
    combinedQuestions = mergeQuestionsByTarget(words, combinedQuestions, normalized);
    pendingWords = getMissingQuestionWords(combinedQuestions, words);
  }

  assertQuestionCoverage('Vocabulary in Context', combinedQuestions, words);
  return combinedQuestions;
}

async function generateExamQuestionPack(
  openai: OpenAI,
  data: LearningData,
): Promise<LearningData> {
  const { sentenceWords, contextWords } = createExamQuestionPlan(data.words);
  const [sentenceClozeQuestions, vocabularyInContextQuestions] = await Promise.all([
    generateSentenceClozeQuestions(openai, sentenceWords, data.words),
    generateVocabularyInContextQuestions(openai, contextWords, data.words),
  ]);

  return {
    ...data,
    sentenceClozeQuestions,
    vocabularyInContextQuestions,
  };
}

async function generateMaterialChunk(
  openai: OpenAI,
  parsedWords: ParsedWordInput[],
  chunkIndex: number,
  chunkCount: number,
): Promise<LearningData> {
  const prompt = `${buildMaterialsPrompt(parsedWords)}

  This is batch ${chunkIndex + 1} of ${chunkCount}. Only return material for the words listed in this batch.
  Keep the output short and focused on just these ${parsedWords.length} words.`;

  const response = await withProviderRetries(
    () =>
      openai.chat.completions.create({
        model: MOONSHOT_MODEL,
        messages: [
          { role: "system", content: "You are a helpful vocabulary teacher. Output strictly valid JSON." },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        max_tokens: 2200,
      }),
    `Learning material generation batch ${chunkIndex + 1}`,
    4,
  );

  const content = extractJsonObject(response.choices[0].message.content || "{}");
  try {
    return JSON.parse(content) as LearningData;
  } catch (parseError) {
    console.error(`Batch ${chunkIndex + 1} JSON parse failed, attempting repair.`, parseError);
    return repairMalformedJsonObject<LearningData>(openai, content, MOONSHOT_MODEL);
  }
}

export async function generateMaterials(words: string): Promise<LearningData> {
  const openai = createMoonshotClient();

  const parsedWords = parseWordInputs(words);

  try {
    const batches = chunkArray(parsedWords, 4);
    const chunkResults: LearningData[] = [];

    for (const [chunkIndex, batch] of batches.entries()) {
      try {
        const result = await generateMaterialChunk(openai, batch, chunkIndex, batches.length);
        chunkResults.push(result);
      } catch (error) {
        if (!isTimeoutLikeError(error) && !isProviderBusyError(error)) {
          throw error;
        }

        console.error(`Learning material batch ${chunkIndex + 1} timed out, using local fallback.`, error);
        chunkResults.push(
          normalizeLearningData(
            {
              words: [],
              articles: [],
            },
            batch,
            0,
          ),
        );
      }
    }

    const combined: LearningData = {
      words: chunkResults.flatMap((result) => result.words || []),
      articles: [],
      sentenceClozeQuestions: [],
      vocabularyInContextQuestions: [],
    };

    const normalized = normalizeLearningData(combined, parsedWords, 0);
    const withPlayableSynonyms = await ensurePlayableSynonyms(openai, normalized);
    const withRepairedExamples = await repairMissingExamples(openai, withPlayableSynonyms);
    return {
      ...withRepairedExamples,
      articles: [],
      sentenceClozeQuestions: [],
      vocabularyInContextQuestions: [],
    };
  } catch (error) {
    console.error("Material generation failed.", error);
    throw new Error(extractErrorMessage(error));
  }
}

export async function generateSentenceClozeModule(
  data: LearningData,
): Promise<SentenceClozeQuestion[]> {
  const openai = createMoonshotClient();
  const { sentenceWords } = createExamQuestionPlan(data.words);

  try {
    return await generateSentenceClozeQuestions(openai, sentenceWords, data.words);
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

export async function generateVocabularyInContextModule(
  data: LearningData,
): Promise<VocabularyInContextQuestion[]> {
  const openai = createMoonshotClient();
  const { contextWords } = createExamQuestionPlan(data.words);

  try {
    return await generateVocabularyInContextQuestions(openai, contextWords, data.words);
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

export async function regenerateStoryArticles(
  data: LearningData,
  storyCount: number,
): Promise<LearningData["articles"]> {
  const openai = createMoonshotClient();
  try {
    const coherent = await ensureCoherentArticles(openai, data, Math.max(1, storyCount));
    return coherent.articles;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

function shuffleWords<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

export async function generateNextStoryArticle(
  data: LearningData,
): Promise<LearningData["articles"][number]> {
  const usedAnswers = new Set(
    data.articles.flatMap((article) => article.blanks.map((blank) => blank.answer.toLowerCase())),
  );
  const remainingWords = data.words.filter((word) => !usedAnswers.has(word.word.toLowerCase()));

  if (remainingWords.length === 0) {
    throw new Error('All of today’s words have already been used in stories.');
  }

  const selectedWords = shuffleWords(remainingWords).slice(0, Math.min(10, remainingWords.length));
  const openai = createMoonshotClient();

  try {
    return await generateStoryArticle(openai, selectedWords, data.words, data.articles.length, undefined, data.articles);
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

export async function regenerateSingleStoryArticle(
  data: LearningData,
  articleIndex: number,
): Promise<LearningData["articles"][number]> {
  const article = data.articles[articleIndex];
  if (!article) {
    throw new Error(`Story ${articleIndex + 1} does not exist.`);
  }

  const chunk = article.blanks.map((blank) => {
    const matchedWord = data.words.find((word) => word.word.toLowerCase() === blank.answer.toLowerCase());

    return (
      matchedWord || {
        word: blank.answer,
        synonym: '',
        partOfSpeech: 'word',
        definition: '',
        exampleSentence: '',
        exampleSentenceWithBlank: '',
      }
    );
  });
  const expectedArticle: LearningData["articles"][number] = {
    text: '',
    blanks: article.blanks,
    distractors: article.distractors,
  };
  const openai = createMoonshotClient();

  try {
    return await generateStoryArticle(
      openai,
      chunk,
      data.words,
      articleIndex,
      expectedArticle,
      data.articles.filter((_, index) => index !== articleIndex),
    );
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}
