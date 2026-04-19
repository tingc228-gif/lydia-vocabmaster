export interface WordData {
  word: string;
  synonym: string;
  partOfSpeech: string;
  definition: string;
  exampleSentence: string;
  exampleSentenceWithBlank: string;
}

export interface ArticleBlank {
  id: string;
  answer: string;
  explanation: string;
}

export interface ArticleData {
  text: string;
  blanks: ArticleBlank[];
  distractors: string[];
}

export interface SentenceClozeQuestion {
  id: string;
  targetWord: string;
  sentence: string;
  options: string[];
  answer: string;
  explanation: string;
}

export interface VocabularyInContextQuestion {
  id: string;
  targetWord: string;
  passage: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

export interface LearningData {
  words: WordData[];
  articles: ArticleData[];
  sentenceClozeQuestions: SentenceClozeQuestion[];
  vocabularyInContextQuestions: VocabularyInContextQuestion[];
}

export type PetRewardKind = 'food' | 'joy' | 'growth' | 'care';

export type PetAnimationState = 'resting' | 'feeding' | 'joyful' | 'growing';

export interface PetState {
  foodPercent: number;
  joyPercent: number;
  growthPercent: number;
  careRound: number;
  animationState: PetAnimationState;
}

export interface PetRewardEvent {
  kind: PetRewardKind;
  amount: number;
  source: string;
  message: string;
}
