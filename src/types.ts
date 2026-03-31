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

export interface LearningData {
  words: WordData[];
  articles: ArticleData[];
}
