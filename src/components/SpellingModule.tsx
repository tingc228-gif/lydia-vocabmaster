import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Lightbulb, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { LearningData } from '../types';

export default function SpellingModule({
  data,
  onComplete,
}: {
  data: LearningData;
  onComplete?: (usedHint: boolean) => void;
}) {
  const [queue, setQueue] = useState<number[]>(data.words.map((_, index) => index));
  const [masteredCount, setMasteredCount] = useState(0);
  const [input, setInput] = useState('');
  const [hintsShown, setHintsShown] = useState(0);
  const [isCorrect, setIsCorrect] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [currentTurn, setCurrentTurn] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const usedAnyHintRef = useRef(false);

  const currentWordIndex = queue[0];
  const currentWord = currentWordIndex !== undefined ? data.words[currentWordIndex] : null;

  useEffect(() => {
    if (!currentWord || isFinished) return;

    setInput('');
    setHintsShown(0);
    setIsCorrect(false);
    inputRef.current?.focus();

    setTimeout(() => {
      inputRef.current?.focus();
    }, 240);
  }, [currentTurn, currentWord, isFinished]);

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      if (!isCorrect && inputRef.current && !(event.target as HTMLElement).closest('button')) {
        inputRef.current.focus();
      }
    };

    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, [isCorrect]);

  const handleCorrect = (usedHint: boolean) => {
    setIsCorrect(true);

    setTimeout(() => {
      setQueue((previousQueue) => {
        const newQueue = [...previousQueue];
        const finishedIndex = newQueue.shift();

        if (finishedIndex !== undefined) {
          if (usedHint) newQueue.push(finishedIndex);
          else setMasteredCount((count) => count + 1);
        }

        if (newQueue.length === 0) setIsFinished(true);
        return newQueue;
      });
      if (queue.length === 1) {
        onComplete?.(usedAnyHintRef.current || usedHint);
      }
      setCurrentTurn((turn) => turn + 1);
    }, 900);
  };

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setInput(value);

    if (currentWord && value.toLowerCase().trim() === currentWord.word.toLowerCase()) {
      handleCorrect(hintsShown > 0);
    }
  };

  const showHint = () => {
    if (!currentWord) return;

    const nextHints = Math.min(hintsShown + 1, currentWord.word.length);
    setHintsShown(nextHints);
    usedAnyHintRef.current = true;

    const correctPrefix = currentWord.word.substring(0, nextHints);
    setInput(correctPrefix);

    if (correctPrefix.toLowerCase() === currentWord.word.toLowerCase()) {
      handleCorrect(true);
    }

    inputRef.current?.focus();
  };

  const restart = () => {
    setQueue(data.words.map((_, index) => index));
    setMasteredCount(0);
    setIsFinished(false);
    usedAnyHintRef.current = false;
    setCurrentTurn((turn) => turn + 1);
  };

  if (isFinished) {
    return (
      <div className="celebration-panel studio-card">
        <div className="celebration-badge">
          <CheckCircle2 size={42} />
        </div>
        <h2 className="text-5xl font-semibold">Spelling run complete</h2>
        <p className="module-subcopy mx-auto mt-4 max-w-2xl">
          You finished this spelling round. Words solved without hints count as mastered, and words with hints go back for another try.
        </p>
        <button type="button" onClick={restart} className="primary-button mx-auto mt-8">
          <RotateCcw size={18} />
          Practice again
        </button>
      </div>
    );
  }

  if (!currentWord) return null;

  const progress = (masteredCount / data.words.length) * 100;
  const sanitizedInput = input.replace(/\s+/g, '');

  return (
    <div className="grid gap-5 lg:grid-cols-[0.56fr_1.44fr]">
      <aside className="studio-card">
        <div className="module-header">
          <div>
            <span className="module-pill">Active recall</span>
            <h2 className="mt-4 text-4xl font-semibold">Type the exact word from memory</h2>
            <p className="module-subcopy mt-3">The game keeps track of hints and decides whether a word is fully mastered or needs another turn.</p>
          </div>
        </div>

        <div className="progress-strip">
          <strong>Mastered {masteredCount}</strong>
          <span className="text-sm font-semibold text-slate-500">{data.words.length} total</span>
        </div>
        <div className="progress-bar">
          <div className="progress-value" style={{ width: `${progress}%` }} />
        </div>

        <div className="mt-8 grid gap-4">
          <div className="studio-panel">
            <p className="eyebrow">Current hint usage</p>
            <p className="text-3xl font-semibold">{hintsShown}</p>
          </div>
        </div>
      </aside>

      <section className="studio-card">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentWordIndex}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            transition={{ duration: 0.24 }}
          >
            <div className="module-header">
              <div>
                <span className="module-pill">{currentWord.partOfSpeech}</span>
                <h3 className="mt-4 text-4xl font-semibold leading-tight">{currentWord.definition}</h3>
              </div>
            </div>

            <div className="mb-8 flex flex-wrap justify-center gap-3">
              {currentWord.word.split('').map((char, index) => {
                const isHinted = index < hintsShown;
                const typedChar = sanitizedInput[index];
                const isTyped = Boolean(typedChar);
                const displayChar = isHinted ? char : isTyped ? typedChar : '';

                return (
                  <div
                    key={index}
                    className={`flex h-16 w-14 items-center justify-center rounded-[22px] border text-3xl font-extrabold uppercase shadow-[0_10px_24px_rgba(7,6,28,0.22)] transition-all md:h-[88px] md:w-16 ${
                      isHinted
                        ? 'border-[#ffd36c] bg-[linear-gradient(180deg,rgba(255,227,168,0.98),rgba(255,206,120,0.92))] text-[#5c420b]'
                        : isCorrect
                          ? 'border-emerald-400 bg-[linear-gradient(180deg,rgba(194,255,237,0.98),rgba(122,231,193,0.94))] text-emerald-900'
                          : isTyped
                            ? 'border-[#a88dff] bg-[linear-gradient(180deg,rgba(242,237,255,0.98),rgba(223,213,255,0.94))] text-[#4b3c8d]'
                            : 'border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.07))] text-white/20'
                    }`}
                  >
                    {displayChar}
                  </div>
                );
              })}
            </div>

            <div className="mx-auto max-w-xl">
              <div className="relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={handleInput}
                  disabled={isCorrect}
                  autoFocus
                  className={`studio-input !h-[82px] !rounded-[28px] !border-2 !px-8 text-center !text-4xl font-extrabold tracking-[0.08em] placeholder:!tracking-[0.12em] ${
                    isCorrect
                      ? '!border-emerald-400 !bg-[linear-gradient(180deg,rgba(202,255,239,0.96),rgba(134,235,198,0.92))] !text-emerald-950'
                      : '!border-[#ffd36c]/45 !bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(232,226,255,0.72))] !text-[#9a3568] placeholder:!text-[#c6a7bd] shadow-[0_0_0_4px_rgba(255,211,108,0.06),0_18px_34px_rgba(244,195,220,0.24)]'
                  }`}
                  placeholder="Type here"
                  autoComplete="off"
                  spellCheck="false"
                />
                {isCorrect && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute right-5 top-1/2 -translate-y-1/2 text-emerald-600">
                    <CheckCircle2 size={30} />
                  </motion.div>
                )}
              </div>

              <button
                type="button"
                onClick={showHint}
                disabled={isCorrect || hintsShown === currentWord.word.length}
                className="secondary-button mt-5 w-full"
              >
                <Lightbulb size={18} />
                Reveal one more letter
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      </section>
    </div>
  );
}
