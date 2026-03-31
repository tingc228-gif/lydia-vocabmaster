export type TopicId = 'matter' | 'heat' | 'systems';

export type Difficulty = 'foundation' | 'standard' | 'challenge';

export type QuestionType = 'mcq' | 'short_open' | 'experiment';

export interface SourceItem {
  title: string;
  category: 'syllabus' | 'chapter_notes' | 'error_book' | 'school_exam';
  path: string;
  topicTags: TopicId[];
}

export interface QuestionOption {
  id: string;
  text: string;
}

export interface ScienceQuestion {
  id: string;
  topic: TopicId;
  type: QuestionType;
  difficulty: Difficulty;
  sourceHint: string;
  stem: string;
  options?: QuestionOption[];
  answer: string;
  explanation: string;
  skills: string[];
}
