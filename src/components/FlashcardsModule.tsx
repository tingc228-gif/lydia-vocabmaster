import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { LearningData } from '../types';

const toSentenceCase = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
};

export default function FlashcardsModule({ data }: { data: LearningData }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  const word = data.words[currentIndex];
  const displayWord = toSentenceCase(word.word);
  const displayDefinition = toSentenceCase(word.definition);

  const next = () => {
    setIsFlipped(false);
    setCurrentIndex((index) => Math.min(index + 1, data.words.length - 1));
  };

  const prev = () => {
    setIsFlipped(false);
    setCurrentIndex((index) => Math.max(index - 1, 0));
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[0.58fr_1.42fr]">
      <aside className="studio-card">
        <div className="module-header">
          <div>
            <span className="module-pill">Flashcards</span>
            <h2 className="mt-4 text-4xl font-semibold">Flip, peek, and remember</h2>
            <p className="module-subcopy mt-3">See the word on the front, then flip to check the meaning and example.</p>
          </div>
        </div>

        <div className="progress-strip">
          <strong>Card {currentIndex + 1}</strong>
          <span className="text-sm font-semibold text-slate-500">{data.words.length} cards</span>
        </div>
        <div className="progress-bar">
          <div className="progress-value" style={{ width: `${((currentIndex + 1) / data.words.length) * 100}%` }} />
        </div>

        <div className="mt-8 space-y-4 text-white">
          <div className="studio-panel">
            <p className="eyebrow">Word</p>
            <h3 className="text-3xl font-semibold text-white">{displayWord}</h3>
          </div>
          <div className="studio-panel">
            <p className="eyebrow">Part of speech</p>
            <p className="text-xl font-semibold text-[#f9e7b0]">{word.partOfSpeech}</p>
          </div>
          <div className="studio-panel">
            <p className="eyebrow">Hint</p>
            <p className="text-sm leading-7 text-white/78">Try guessing the meaning before you flip the card.</p>
          </div>
        </div>
      </aside>

      <section className="studio-card">
        <div className="flashcard-stage" onClick={() => setIsFlipped((value) => !value)}>
          <div className={`flashcard-shell ${isFlipped ? 'is-flipped' : ''}`}>
            <article className="flashcard-face flashcard-front studio-card">
              <div className="flex items-start justify-between gap-4">
                <span className="module-pill">Front</span>
                <span className="text-sm font-semibold text-slate-500">Tap to flip</span>
              </div>

              <div>
                <p className="eyebrow">Vocabulary</p>
                <h2 className="flashcard-word">{displayWord}</h2>
              </div>

              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="eyebrow">Part of speech</p>
                  <p className="text-xl font-semibold">{word.partOfSpeech}</p>
                </div>
                <div className="module-pill">
                  <RotateCcw size={14} />
                  Flip for meaning
                </div>
              </div>
            </article>

            <article className="flashcard-face flashcard-back studio-card">
              <div className="flex items-start justify-between gap-4">
                <span className="module-pill bg-white/10 text-white">Back</span>
                <span className="text-sm font-semibold text-white/70">Meaning + example</span>
              </div>

              <div className="space-y-5">
                <div>
                  <p className="eyebrow text-white/70">Definition</p>
                  <h3 className="exercise-prompt">{displayDefinition}</h3>
                </div>
                <div className="h-px bg-white/15" />
                <div>
                  <p className="eyebrow text-white/70">Example</p>
                  <p className="text-xl leading-8 text-white/88">"{word.exampleSentence}"</p>
                </div>
              </div>

              <div className="text-sm font-semibold text-white/72">Say the meaning out loud if you can.</div>
            </article>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-4">
          <button type="button" onClick={prev} disabled={currentIndex === 0} className="secondary-button">
            <ChevronLeft size={18} />
            Previous
          </button>
          <button type="button" onClick={() => setIsFlipped((value) => !value)} className="ghost-button">
            <RotateCcw size={18} />
            Flip card
          </button>
          <button type="button" onClick={next} disabled={currentIndex === data.words.length - 1} className="secondary-button">
            Next
            <ChevronRight size={18} />
          </button>
        </div>
      </section>
    </div>
  );
}
