import { OpenAI } from "openai";
import { LearningData } from "../types";

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
      maybeError.message,
      maybeError.error?.message,
      typeof maybeError.response?.data === 'string' ? maybeError.response?.data : undefined,
      maybeError.response?.text,
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

  return error instanceof Error ? error.message : String(error);
}

interface ParsedWordInput {
  word: string;
  providedDefinition?: string;
}

function parseWordInputs(rawWords: string): ParsedWordInput[] {
  return rawWords
    .split(/\n+/)
    .flatMap((line) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/))
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

function normalizePhrase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
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

function looksLikeWeakFallbackStory(text: string): boolean {
  const compact = text.trim().toLowerCase();
  return (
    compact.includes('appears in this study set') ||
    compact.includes('the word [blank_') ||
    compact.includes('became the best way to describe what happened next in the story') ||
    compact.includes('helped the whole adventure land in exactly the right way') ||
    compact.includes('was the detail everyone kept talking about on the walk home')
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

function buildFallbackArticles(words: LearningData["words"], articleCount: number): LearningData["articles"] {
  const safeArticleCount = Math.max(1, articleCount);
  const chunks: typeof words[] = Array.from({ length: safeArticleCount }, () => []);

  words.forEach((word, index) => {
    chunks[index % safeArticleCount].push(word);
  });

  return chunks
    .filter((chunk) => chunk.length > 0)
    .map((chunk, articleIndex) => {
      const blankSentences = chunk.map((word, index) => {
        const blankId = `blank_${index}`;
        const sourceSentence = (word.exampleSentenceWithBlank || word.exampleSentence || '').trim();
        const normalizedSource = sourceSentence.toLowerCase();

        if (!sourceSentence || normalizedSource.includes('appears in this study set')) {
          return buildStorySentence(word, blankId, index, chunk.length);
        }

        return replaceWordWithBlank(sourceSentence, word.word, blankId).trim().replace(/\s+/g, ' ');
      });

      const intro = `On story day ${articleIndex + 1}, Mia, Leo, and their classmates were getting ready for the school showcase when a missing prop, a nervous teacher, and a noisy crowd turned an ordinary rehearsal into a real adventure.`;
      const bridge = `Instead of arguing, the friends split up, followed clues around the stage, and slowly began to understand how all the small problems were connected.`;
      const outro = `When the curtain finally rose, the class had solved the mystery together, and the whole afternoon felt like one complete story instead of a pile of separate moments.`;

      return {
        text: [
          intro,
          ...blankSentences.slice(0, Math.ceil(blankSentences.length / 3)),
          bridge,
          ...blankSentences.slice(Math.ceil(blankSentences.length / 3), Math.ceil((blankSentences.length * 2) / 3)),
          `For a moment it seemed the showcase might fail, but no one wanted to quit while there was still time to help.`,
          ...blankSentences.slice(Math.ceil((blankSentences.length * 2) / 3)),
          outro,
        ].join(' '),
        blanks: chunk.map((word, index) => ({
          id: `blank_${index}`,
          answer: word.word,
          explanation: `${word.word} fits because it matches the meaning and tone of this part of the story.`,
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

  const response = await openai.chat.completions.create({
    model: "deepseek-chat",
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
- Do not write definition-style text like "means...".
- Keep distractors to exactly 2 items.

${articlePrompt}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 8192,
  });

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
            explanation: String(blank.explanation || '').trim() || 'This word fits the story best here.',
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

function normalizeArticleCandidate(
  article: any,
  fallbackArticle: LearningData["articles"][number],
): LearningData["articles"][number] {
  const normalized = {
    text: String(article?.text ?? '').trim(),
    blanks: Array.isArray(article?.blanks)
      ? article.blanks.map((blank: any, index: number) => ({
          id: String(blank?.id ?? `blank_${index}`),
          answer: String(blank?.answer ?? '').trim(),
          explanation: String(blank?.explanation ?? '').trim() || 'This word fits the story best here.',
        }))
      : [],
    distractors: Array.isArray(article?.distractors)
      ? article.distractors.map((word: any) => String(word ?? '').trim()).filter(Boolean).slice(0, 2)
      : [],
  };

  if (
    !normalized.text ||
    normalized.blanks.length !== fallbackArticle.blanks.length ||
    looksLikeDefinitionDrill(normalized.text) ||
    looksLikeWeakFallbackStory(normalized.text)
  ) {
    return fallbackArticle;
  }

  const expectedIds = fallbackArticle.blanks.map((blank) => blank.id);
  const expectedAnswers = fallbackArticle.blanks.map((blank) => blank.answer.toLowerCase());
  const gotIds = normalized.blanks.map((blank) => blank.id);
  const gotAnswers = normalized.blanks.map((blank) => blank.answer.toLowerCase());

  const sameIds = expectedIds.every((id, index) => gotIds[index] === id);
  const sameAnswers = expectedAnswers.every((answer, index) => gotAnswers[index] === answer);

  if (!sameIds || !sameAnswers) {
    return fallbackArticle;
  }

  return {
    ...normalized,
    distractors: normalized.distractors.length === 2 ? normalized.distractors : fallbackArticle.distractors,
  };
}

async function generateStoryArticles(
  openai: OpenAI,
  words: LearningData["words"],
  articleCount: number,
): Promise<LearningData["articles"]> {
  const fallbackArticles = buildFallbackArticles(words, articleCount);
  const chunks = buildArticleChunks(words, articleCount);

  const articleSpecs = chunks
    .map((chunk, articleIndex) => {
      const blankSpecs = chunk
        .map(
          (word, index) =>
            `${`blank_${index}`} => word=${word.word}; partOfSpeech=${word.partOfSpeech}; definition=${word.definition}; example=${word.exampleSentence}`,
        )
        .join('\n');

      const distractors = words
        .filter((candidate) => !chunk.some((item) => item.word === candidate.word))
        .slice(articleIndex * 2, articleIndex * 2 + 2)
        .map((word) => word.word)
        .join(', ');

      return `Article ${articleIndex}
Write one short coherent story for upper-elementary learners.
The story must feel continuous, with setup, problem, and resolution.
Use these blanks in this exact order:
${blankSpecs}
Use exactly these distractors if possible: ${distractors}`;
    })
    .join('\n\n');

  const response = await openai.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content:
          "You write short coherent children's stories for vocabulary practice. Return strictly valid JSON only. Every article must read like one connected story, not a list of unrelated sentences.",
      },
      {
        role: "user",
        content: `Return JSON in this exact shape:
{"articles":[{"index":0,"text":"The girl felt [blank_0] as she stepped onto the stage, and the lights began to [blank_1] above her.","blanks":[{"id":"blank_0","answer":"brave","explanation":"brave fits because she overcame her fear"},{"id":"blank_1","answer":"sparkle","explanation":"sparkle describes the shining lights"}],"distractors":["quiet","heavy"]}]}

Rules:
- Generate exactly ${chunks.length} articles.
- Each article must be one connected story or passage.
- In the "text" field, replace each vocabulary word with its placeholder [blank_0], [blank_1], etc. Do NOT write the actual word in the text — use only the [blank_N] marker.
- Keep blank ids and answers exactly as specified.
- Do not write definition-style text.
- Do not use generic filler like "appears in this study set".
- Keep distractors to exactly 2 strings.

${articleSpecs}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 8192,
  });

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
    // Try to repair truncated JSON by closing open brackets
    const repaired = content.replace(/,?\s*$/, '') + ']}';
    try {
      parsed = JSON.parse(repaired);
    } catch {
      console.error('Story JSON could not be repaired, using fallback articles.');
      return fallbackArticles;
    }
  }

  const articleMap = new Map<number, LearningData["articles"][number]>();
  for (const item of parsed.articles || []) {
    const index = Number(item.index);
    if (!Number.isInteger(index)) continue;
    const fallbackArticle = fallbackArticles[index];
    if (!fallbackArticle) continue;
    articleMap.set(index, normalizeArticleCandidate(item, fallbackArticle));
  }

  return fallbackArticles.map((fallbackArticle, index) => articleMap.get(index) || fallbackArticle);
}

function createMoonshotClient(apiKey: string) {
  return new OpenAI({
    baseURL:
      typeof window !== 'undefined'
        ? `${window.location.origin}/moonshot/v1`
        : 'http://localhost:3001/moonshot/v1',
    apiKey,
    dangerouslyAllowBrowser: true,
  });
}

function createDeepSeekClient(apiKey: string) {
  return new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey,
    dangerouslyAllowBrowser: true,
  });
}

function normalizeLearningData(input: any, requestedWords: ParsedWordInput[], articleCount: number): LearningData {
  const words = Array.isArray(input?.words) ? input.words : [];
  const articles = Array.isArray(input?.articles) ? input.articles : [];

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
            explanation: String(blank?.explanation ?? '').trim() || 'No explanation provided.',
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

  return {
    words: completedWords,
    articles: completedArticles,
  };
}

async function repairMalformedJson(
  openai: OpenAI,
  malformedContent: string,
  model: string = "moonshot-v1-128k",
): Promise<LearningData> {
  const repairResponse = await openai.chat.completions.create({
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
    response_format: { type: "json_object" },
  });

  const repairedContent = extractJsonObject(repairResponse.choices[0].message.content || "{}");
  return JSON.parse(repairedContent) as LearningData;
}

async function repairSynonyms(
  openai: OpenAI,
  words: Array<{ word: string; definition: string; synonym: string }>,
): Promise<Record<string, string>> {
  const response = await openai.chat.completions.create({
    model: "moonshot-v1-128k",
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
    response_format: { type: "json_object" },
  });

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
  try {
    repairedMap = await repairSynonyms(openai, repairTargets);
  } catch (error) {
    console.error('Synonym repair failed, using fallback synonyms.', error);
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
    const repairedArticles = await repairWeakArticles(openai, {
      ...data,
      articles: generatedArticles,
    });
    return {
      ...data,
      articles: repairedArticles,
    };
  } catch (error) {
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

  const wordSpecs = badWords
    .map((w) => `word=${w.word}; partOfSpeech=${w.partOfSpeech}; definition=${w.definition}`)
    .join('\n');

  try {
    const response = await openai.chat.completions.create({
      model: "moonshot-v1-128k",
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
      response_format: { type: "json_object" },
      max_tokens: 8192,
    });

    const content = extractJsonObject(response.choices[0].message.content || "{}");
    const parsed = JSON.parse(content) as {
      examples?: Array<{ word?: string; exampleSentence?: string; exampleSentenceWithBlank?: string }>;
    };

    const exampleMap = new Map<string, { sentence: string; blank: string }>();
    for (const item of parsed.examples || []) {
      const w = String(item.word || '').trim().toLowerCase();
      const s = String(item.exampleSentence || '').trim();
      const b = String(item.exampleSentenceWithBlank || '').trim();
      if (w && s && !isBadExample(s, item.word || '')) {
        exampleMap.set(w, { sentence: s, blank: b || replaceWordWithBlank(s, item.word || '', '___') });
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
  } catch {
    return data;
  }
}

export async function generateMaterials(apiKey: string, words: string): Promise<LearningData> {
  const openai = createMoonshotClient(apiKey);

  const parsedWords = parseWordInputs(words);
  const wordList = parsedWords.map((item) => item.word);
  
  const prompt = `
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

  try {
    const response = await openai.chat.completions.create({
      model: "moonshot-v1-128k",
      messages: [
        { role: "system", content: "You are a helpful vocabulary teacher. Output strictly valid JSON." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    const content = extractJsonObject(response.choices[0].message.content || "{}");
    let parsedContent: LearningData;

    try {
      parsedContent = JSON.parse(content) as LearningData;
    } catch (parseError) {
      console.error("Initial JSON parse failed, attempting repair.", parseError);
      parsedContent = await repairMalformedJson(openai, content, "moonshot-v1-128k");
    }

    const normalized = normalizeLearningData(parsedContent, parsedWords, 0);
    const withPlayableSynonyms = await ensurePlayableSynonyms(openai, normalized);
    const withRepairedExamples = await repairMissingExamples(openai, withPlayableSynonyms);
    return {
      ...withRepairedExamples,
      articles: [],
    };
  } catch (error) {
    console.error("Material generation failed.", error);
    throw new Error(extractErrorMessage(error));
  }
}

export async function regenerateStoryArticles(
  apiKey: string,
  data: LearningData,
  storyCount: number,
): Promise<LearningData["articles"]> {
  const openai = createDeepSeekClient(apiKey);
  try {
    const coherent = await ensureCoherentArticles(openai, data, Math.max(1, storyCount));
    return coherent.articles;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}
