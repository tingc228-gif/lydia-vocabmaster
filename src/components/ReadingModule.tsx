import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Key, Sparkles } from 'lucide-react';
import { LearningData } from '../types';

export default function ReadingModule({
  data,
  onArticleScored,
  onRegenerateStories,
  isRegeneratingStories,
}: {
  data: LearningData;
  onArticleScored?: (articleIndex: number, mistakes: number) => void;
  onRegenerateStories?: (apiKey: string, storyCount: number) => Promise<void> | void;
  isRegeneratingStories?: boolean;
}) {
  const [currentArticleIndex, setCurrentArticleIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selectedBlank, setSelectedBlank] = useState<string | null>(null);
  const [showExplanations, setShowExplanations] = useState(false);
  const [scoredArticles, setScoredArticles] = useState<number[]>([]);
  const [storyApiKey, setStoryApiKey] = useState('');
  const [storyCount, setStoryCount] = useState(Math.max(1, data.articles.length || 1));

  const article = data.articles[currentArticleIndex];

  useEffect(() => {
    setAnswers({});
    setSelectedBlank(null);
    setShowExplanations(false);
  }, [currentArticleIndex, data]);

  useEffect(() => {
    setScoredArticles([]);
  }, [data]);

  useEffect(() => {
    const savedKey =
      localStorage.getItem('deepseek_story_api_key') ||
      localStorage.getItem('deepseek_api_key') ||
      localStorage.getItem('kimi_api_key');
    if (savedKey) setStoryApiKey(savedKey);
  }, []);

  useEffect(() => {
    setStoryCount(Math.max(1, data.articles.length || 1));
  }, [data.articles.length]);

  const wordBank = useMemo(() => {
    if (!article) return [];

    const words = article.blanks.map((blank) => blank.answer);
    const safeDistractors = (article.distractors || []).filter((word) => !words.includes(word)).slice(0, 2);
    return [...words, ...safeDistractors].sort(() => 0.5 - Math.random());
  }, [article]);

  if (!article) {
    return (
      <div className="grid gap-5 lg:grid-cols-[0.42fr_1.58fr]">
        <aside>
          <section className="studio-card h-full">
            <div className="flex h-full flex-col">
              <div className="mb-5 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                <label className="field-label">
                  <Key size={16} />
                  DeepSeek Story Key
                </label>
                <input
                  type="password"
                  value={storyApiKey}
                  onChange={(event) => {
                    const value = event.target.value;
                    setStoryApiKey(value);
                    localStorage.setItem('deepseek_story_api_key', value);
                  }}
                  placeholder="sk-..."
                  className="studio-input"
                />
                <div className="mt-4">
                  <label className="field-label">
                    <ChevronRight size={16} />
                    Story count
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={Math.max(1, data.words.length)}
                    value={storyCount}
                    onChange={(event) => setStoryCount(Math.max(1, Number(event.target.value) || 1))}
                    className="studio-input"
                  />
                  <p className="muted-copy mt-2 text-sm">
                    About {Math.max(1, Math.floor(data.words.length / Math.max(1, storyCount)))} blanks per story
                    ({data.words.length} words total divided across {storyCount} stories)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRegenerateStories?.(storyApiKey, storyCount)}
                  disabled={!storyApiKey.trim() || !onRegenerateStories || !!isRegeneratingStories}
                  className="primary-button mt-4 w-full"
                >
                  {isRegeneratingStories ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    <>
                      <Sparkles size={18} />
                      Generate stories
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>
        </aside>
        <section>
          <div className="studio-card text-center">
            <p className="eyebrow">Reading lab</p>
            <h2 className="text-4xl font-semibold">No story is ready yet</h2>
            <p className="module-subcopy mx-auto mt-4 max-w-2xl">
              Enter your DeepSeek API key, set the number of stories, then click Generate to create reading passages.
            </p>
          </div>
        </section>
      </div>
    );
  }

  const handleWordClick = (word: string) => {
    if (!selectedBlank) return;

    const isUsed = Object.values(answers).includes(word);
    if (isUsed) {
      const previousBlank = Object.keys(answers).find((key) => answers[key] === word);
      if (!previousBlank) return;

      setAnswers((previous) => {
        const next = { ...previous };
        delete next[previousBlank];
        return { ...next, [selectedBlank]: word };
      });
    } else {
      setAnswers((previous) => ({ ...previous, [selectedBlank]: word }));
    }

    setSelectedBlank(null);
  };

  const renderText = () => {
    const parts = article.text.split(/(\[blank_\d+\])/g);
    return parts.map((part, index) => {
      const match = part.match(/\[(blank_\d+)\]/);
      if (!match) return <span key={index}>{part}</span>;

      const blankId = match[1];
      const answer = answers[blankId];
      const correctWord = article.blanks.find((blank) => blank.id === blankId)?.answer;
      const isSelected = selectedBlank === blankId;

      let stateClass = '';
      if (showExplanations) stateClass = answer === correctWord ? 'is-correct' : 'is-wrong';
      else if (isSelected) stateClass = 'is-selected';

      return (
        <button
          key={index}
          type="button"
          onClick={() => !showExplanations && setSelectedBlank(blankId)}
          className={`reading-blank ${stateClass}`}
        >
          {answer || ''}
          {showExplanations && answer !== correctWord && correctWord ? (
            <span className="ml-2 text-sm font-black text-emerald-700">({correctWord})</span>
          ) : null}
        </button>
      );
    });
  };

  const handleCheckAnswers = () => {
    setShowExplanations(true);

    if (scoredArticles.includes(currentArticleIndex)) return;

    const mistakes = article.blanks.reduce((count, blank) => {
      return answers[blank.id] === blank.answer ? count : count + 1;
    }, 0);

    onArticleScored?.(currentArticleIndex, mistakes);
    setScoredArticles((current) => [...current, currentArticleIndex]);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[0.42fr_1.58fr]">
      <aside>
        <section className="studio-card h-full">
          <div className="flex h-full flex-col">
            <div className="mb-5 flex items-center justify-between gap-3">
              <p className="eyebrow mb-0">Word bank</p>
              <span className="rounded-full bg-white/8 px-4 py-2 text-sm font-extrabold uppercase tracking-[0.16em] text-slate-300">
                {wordBank.length} choices
              </span>
            </div>

            <div className="reading-word-bank">
            {wordBank.map((word) => {
              const isUsed = Object.values(answers).includes(word);
              return (
                <button
                  key={word}
                  type="button"
                  onClick={() => handleWordClick(word)}
                  disabled={!selectedBlank && !isUsed}
                  className={`word-chip word-chip-large ${isUsed ? 'is-disabled' : ''}`}
                >
                  {word}
                </button>
              );
            })}
            </div>

            <button type="button" onClick={handleCheckAnswers} className="primary-button mt-6 w-full">
              <Check size={18} />
              Check answers
            </button>

            <div className="mt-6 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
              <label className="field-label">
                <Key size={16} />
                DeepSeek Story Key
              </label>
              <input
                type="password"
                value={storyApiKey}
                onChange={(event) => {
                  const value = event.target.value;
                  setStoryApiKey(value);
                  localStorage.setItem('deepseek_story_api_key', value);
                }}
                placeholder="sk-..."
                className="studio-input"
              />
              <div className="mt-4">
                <label className="field-label">
                  <ChevronRight size={16} />
                  Story count
                </label>
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, data.words.length)}
                  value={storyCount}
                  onChange={(event) => setStoryCount(Math.max(1, Number(event.target.value) || 1))}
                  className="studio-input"
                />
                <p className="muted-copy mt-2 text-sm">
                  About {Math.max(1, Math.floor(data.words.length / Math.max(1, storyCount)))} blanks per story
                  ({data.words.length} words total divided across {storyCount} stories)
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRegenerateStories?.(storyApiKey, storyCount)}
                disabled={!storyApiKey.trim() || !onRegenerateStories || !!isRegeneratingStories}
                className="primary-button mt-4 w-full"
              >
                {isRegeneratingStories ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <>
                    <Sparkles size={18} />
                    Regenerate stories only
                  </>
                )}
              </button>
            </div>
          </div>
        </section>
      </aside>

      <section className="space-y-5">
        <article className="studio-card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="eyebrow mb-0">Passage</p>
            {data.articles.length > 1 ? (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentArticleIndex((index) => Math.max(0, index - 1))}
                  disabled={currentArticleIndex === 0}
                  className="secondary-button"
                >
                  <ChevronLeft size={18} />
                  Previous
                </button>
                <span className="text-sm font-extrabold uppercase tracking-[0.18em] text-slate-300">
                  Story {currentArticleIndex + 1} / {data.articles.length}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentArticleIndex((index) => Math.min(data.articles.length - 1, index + 1))}
                  disabled={currentArticleIndex === data.articles.length - 1}
                  className="secondary-button"
                >
                  Next
                  <ChevronRight size={18} />
                </button>
              </div>
            ) : null}
          </div>
          <div className="reading-copy mt-4">{renderText()}</div>
        </article>

        {showExplanations ? (
          <article className="studio-card">
            <p className="eyebrow">Explanations</p>
            <div className="mt-5 space-y-4">
              {article.blanks.map((blank, index) => {
                const userAnswer = answers[blank.id];
                const isCorrect = userAnswer === blank.answer;
                return (
                  <div
                    key={blank.id}
                    className={`rounded-[24px] border px-5 py-4 ${
                      isCorrect ? 'border-emerald-400/40 bg-emerald-900/40' : 'border-rose-400/40 bg-rose-900/40'
                    }`}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-black uppercase tracking-[0.16em] text-white/70">
                        Blank {index + 1}
                      </span>
                      <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-bold text-white">{blank.answer}</span>
                      {!isCorrect && userAnswer ? (
                        <span className="rounded-full bg-rose-500/30 px-3 py-1 text-sm font-bold text-rose-300 line-through">
                          {userAnswer}
                        </span>
                      ) : null}
                    </div>
                    <p className="leading-7 text-white/90">{blank.explanation}</p>
                  </div>
                );
              })}
            </div>
          </article>
        ) : null}
      </section>
    </div>
  );
}
