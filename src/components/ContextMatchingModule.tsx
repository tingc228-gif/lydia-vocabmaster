import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, RotateCcw, Sparkles, XCircle } from 'lucide-react';
import { LearningData } from '../types';

export default function ContextMatchingModule({
  data,
  onComplete,
}: {
  data: LearningData;
  onComplete?: (mistakes: number) => void;
}) {
  const questions = data.sentenceClozeQuestions;
  const [questionQueue, setQuestionQueue] = useState<number[]>(questions.map((_, index) => index));
  const [solvedCount, setSolvedCount] = useState(0);
  const [selectedOption, setSelectedOption] = useState('');
  const [checked, setChecked] = useState(false);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const completionSentRef = useRef(false);
  const mistakenQuestionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setQuestionQueue(questions.map((_, index) => index));
    setSolvedCount(0);
    setSelectedOption('');
    setChecked(false);
    setMistakeCount(0);
    setIsFinished(false);
    completionSentRef.current = false;
    mistakenQuestionIdsRef.current = new Set();
  }, [data, questions]);

  const currentQuestionIndex = questionQueue[0];
  const currentQuestion = currentQuestionIndex !== undefined ? questions[currentQuestionIndex] : null;
  const isCorrect = checked && selectedOption === currentQuestion?.answer;
  const progress = questions.length > 0 ? ((isFinished ? questions.length : solvedCount) / questions.length) * 100 : 0;

  const completeQuiz = (finalMistakes: number) => {
    setIsFinished(true);
    if (!completionSentRef.current) {
      completionSentRef.current = true;
      onComplete?.(finalMistakes);
    }
  };

  const handleCheck = () => {
    if (!currentQuestion || !selectedOption || checked) return;

    if (selectedOption !== currentQuestion.answer && !mistakenQuestionIdsRef.current.has(currentQuestion.id)) {
      mistakenQuestionIdsRef.current.add(currentQuestion.id);
      setMistakeCount(mistakenQuestionIdsRef.current.size);
    }

    setChecked(true);
  };

  const handleNext = () => {
    if (!currentQuestion || !checked) return;

    if (isCorrect) {
      const nextQueue = questionQueue.slice(1);
      const nextSolvedCount = solvedCount + 1;

      setSolvedCount(nextSolvedCount);
      if (nextQueue.length === 0) {
        completeQuiz(mistakenQuestionIdsRef.current.size);
      } else {
        setQuestionQueue(nextQueue);
      }
    } else {
      const [currentIndexInQueue, ...remainingQueue] = questionQueue;
      if (currentIndexInQueue !== undefined) {
        setQuestionQueue([...remainingQueue, currentIndexInQueue]);
      }
    }

    setSelectedOption('');
    setChecked(false);
  };

  const handleRestart = () => {
    setQuestionQueue(questions.map((_, index) => index));
    setSolvedCount(0);
    setSelectedOption('');
    setChecked(false);
    setMistakeCount(0);
    setIsFinished(false);
    completionSentRef.current = false;
    mistakenQuestionIdsRef.current = new Set();
  };

  if (questions.length === 0) {
    return (
      <div className="studio-card">
        <div className="module-header">
          <div>
            <span className="module-pill">Sentence Cloze</span>
            <h2 className="mt-4 text-4xl font-semibold">No exam questions yet</h2>
            <p className="module-subcopy mt-3">
              Generate a word set first, and this module will prepare Singapore-style sentence cloze questions.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isFinished) {
    const cleanFirstTimeCount = questions.length - mistakeCount;

    return (
      <div className="celebration-panel studio-card">
        <div className="celebration-badge">
          <Sparkles size={42} />
        </div>
        <h2 className="text-5xl font-semibold">Sentence Cloze complete</h2>
        <p className="module-subcopy mx-auto mt-4 max-w-2xl">
          You kept working through the wrong ones until every sentence was correct. Nice steady exam practice.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm font-bold text-slate-500">
          <span className="rounded-full bg-white px-4 py-2">Solved {questions.length}</span>
          <span className="rounded-full bg-white px-4 py-2">Clean first try {cleanFirstTimeCount}</span>
          <span className="rounded-full bg-white px-4 py-2">Needed retry {mistakeCount}</span>
        </div>
        <button type="button" onClick={handleRestart} className="primary-button mx-auto mt-8">
          <RotateCcw size={18} />
          Try the questions again
        </button>
      </div>
    );
  }

  if (!currentQuestion) return null;

  return (
    <div className="grid gap-5 lg:grid-cols-[0.56fr_1.44fr]">
      <aside className="studio-card">
        <div className="module-header">
          <div>
            <span className="module-pill">Sentence Cloze</span>
            <h2 className="mt-4 text-4xl font-semibold">Choose the best word for the blank</h2>
            <p className="module-subcopy mt-3">
              These are fresh exam-style questions, and any wrong sentence will come back again until it is solved.
            </p>
          </div>
        </div>

        <div className="progress-strip">
          <strong>Solved {solvedCount}</strong>
          <span className="text-sm font-semibold text-slate-500">{questions.length} total</span>
        </div>
        <div className="progress-bar">
          <div className="progress-value" style={{ width: `${progress}%` }} />
        </div>

        <div className="mt-8 grid gap-4">
          <div className="studio-panel">
            <p className="eyebrow">Need retry</p>
            <p className="text-3xl font-semibold">{mistakeCount}</p>
          </div>
          <div className="studio-panel">
            <p className="eyebrow">Target word</p>
            <p className="text-xl font-semibold text-[#d28a43]">{currentQuestion.targetWord}</p>
          </div>
          <div className="studio-panel">
            <p className="eyebrow">Tip</p>
            <p className="muted-copy">Read the whole sentence first, then pick the word that sounds most natural in context.</p>
          </div>
        </div>
      </aside>

      <section className="studio-card">
        <div className="module-header">
          <div>
            <span className="module-pill">Current challenge</span>
            <h3 className="mt-4 text-4xl font-semibold leading-tight">{currentQuestion.sentence}</h3>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {currentQuestion.options.map((option) => {
            const isSelected = selectedOption === option;
            const showCorrect = checked && option === currentQuestion.answer;
            const showWrong = checked && isSelected && option !== currentQuestion.answer;

            return (
              <button
                key={option}
                type="button"
                disabled={checked}
                onClick={() => setSelectedOption(option)}
                className={`rounded-[28px] border px-6 py-5 text-left text-xl font-semibold transition-all ${
                  showCorrect
                    ? 'border-emerald-400 bg-[linear-gradient(180deg,rgba(202,255,239,0.96),rgba(134,235,198,0.92))] text-emerald-950'
                    : showWrong
                      ? 'border-rose-300 bg-[linear-gradient(180deg,rgba(255,236,244,0.98),rgba(255,214,228,0.94))] text-rose-900'
                      : isSelected
                        ? 'border-[#f48fb1] bg-[linear-gradient(180deg,rgba(255,247,252,0.98),rgba(255,231,246,0.92))] text-[#9f658c] shadow-[0_12px_24px_rgba(244,195,220,0.24)]'
                        : 'border-[rgba(209,174,214,0.35)] bg-white/75 text-[#9f658c] hover:border-[#f4a1c6] hover:bg-[#fff7fb]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span>{option}</span>
                  {showCorrect ? <CheckCircle2 size={22} /> : null}
                  {showWrong ? <XCircle size={22} /> : null}
                </div>
              </button>
            );
          })}
        </div>

        {checked ? (
          <div
            className={`mt-6 rounded-[28px] border px-6 py-5 ${
              isCorrect
                ? 'border-emerald-300 bg-[linear-gradient(180deg,rgba(233,255,247,0.98),rgba(214,250,236,0.94))]'
                : 'border-rose-200 bg-[linear-gradient(180deg,rgba(255,244,248,0.98),rgba(255,228,238,0.94))]'
            }`}
          >
            <p className="eyebrow">{isCorrect ? 'Correct' : 'This one will come back later'}</p>
            {!isCorrect ? (
              <p className="mt-2 text-xl font-semibold text-[#9f658c]">
                The best answer is <span className="text-[#b3477d]">{currentQuestion.answer}</span>.
              </p>
            ) : null}
            <p className="mt-3 text-lg leading-8 text-[#8f6488]">{currentQuestion.explanation}</p>
          </div>
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-4">
          <button type="button" onClick={handleRestart} className="ghost-button">
            <RotateCcw size={18} />
            Restart
          </button>
          {!checked ? (
            <button type="button" onClick={handleCheck} disabled={!selectedOption} className="primary-button">
              Check answer
            </button>
          ) : (
            <button type="button" onClick={handleNext} className="primary-button">
              {isCorrect ? 'Next question' : 'Try a different one'}
              <ChevronRight size={18} />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
