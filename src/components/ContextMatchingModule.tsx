import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, ChevronRight, RotateCcw, Star } from 'lucide-react';
import { LearningData } from '../types';

interface MemoryCard {
  id: string;
  pairId: string;
  kind: 'word' | 'definition';
  content: string;
}

const MAX_CARDS_PER_ROUND = 12;
const WORDS_PER_ROUND = Math.floor(MAX_CARDS_PER_ROUND / 2);

const shuffleCards = (cards: MemoryCard[]) => [...cards].sort(() => Math.random() - 0.5);

export default function ContextMatchingModule({
  data,
  onComplete,
}: {
  data: LearningData;
  onComplete?: () => void;
}) {
  const rounds = useMemo(() => {
    const chunks = [];
    for (let index = 0; index < data.words.length; index += WORDS_PER_ROUND) {
      chunks.push(data.words.slice(index, index + WORDS_PER_ROUND));
    }
    return chunks;
  }, [data.words]);

  const [roundIndex, setRoundIndex] = useState(0);

  const baseDeck = useMemo(() => {
    const roundWords = rounds[roundIndex] ?? [];
    const cards = roundWords.flatMap((word, index) => [
      {
        id: `round-${roundIndex}-word-${index}`,
        pairId: `round-${roundIndex}-pair-${index}`,
        kind: 'word' as const,
        content: word.word,
      },
      {
        id: `round-${roundIndex}-definition-${index}`,
        pairId: `round-${roundIndex}-pair-${index}`,
        kind: 'definition' as const,
        content: word.definition,
      },
    ]);

    return shuffleCards(cards);
  }, [roundIndex, rounds]);

  const [deck, setDeck] = useState<MemoryCard[]>(baseDeck);
  const [flippedIds, setFlippedIds] = useState<string[]>([]);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [turns, setTurns] = useState(0);
  const [lockBoard, setLockBoard] = useState(false);
  const [roundTurns, setRoundTurns] = useState<number[]>([]);
  const rewardSent = useRef(false);

  useEffect(() => {
    setRoundIndex(0);
    setRoundTurns([]);
    rewardSent.current = false;
  }, [data]);

  useEffect(() => {
    setDeck(baseDeck);
    setFlippedIds([]);
    setMatchedIds([]);
    setTurns(0);
    setLockBoard(false);
  }, [baseDeck]);

  const currentRoundWords = rounds[roundIndex] ?? [];
  const matchedCount = matchedIds.length / 2;
  const isRoundFinished = currentRoundWords.length > 0 && matchedCount === currentRoundWords.length;
  const isAllFinished = isRoundFinished && roundIndex === rounds.length - 1;
  const cardCount = deck.length;

  const boardColumns = (() => {
    if (cardCount <= 4) return 2;
    if (cardCount <= 6) return 3;
    if (cardCount <= 8) return 4;
    if (cardCount <= 10) return 4;
    if (cardCount <= 12) return 4;
    if (cardCount <= 16) return 4;
    return 5;
  })();

  const boardRows = Math.ceil(cardCount / boardColumns);
  const boardHeight = boardRows <= 2 ? 620 : boardRows === 3 ? 760 : 880;

  const handleRestartRound = () => {
    setDeck(shuffleCards(baseDeck));
    setFlippedIds([]);
    setMatchedIds([]);
    setTurns(0);
    setLockBoard(false);
  };

  const handleNextRound = () => {
    setRoundTurns((current) => {
      const next = [...current];
      next[roundIndex] = turns;
      return next;
    });
    setRoundIndex((index) => Math.min(index + 1, rounds.length - 1));
  };

  const handleRestartAll = () => {
    setRoundTurns([]);
    setRoundIndex(0);
    setDeck(shuffleCards(rounds[0]?.flatMap((word, index) => [
      { id: `round-0-word-${index}`, pairId: `round-0-pair-${index}`, kind: 'word' as const, content: word.word },
      {
        id: `round-0-definition-${index}`,
        pairId: `round-0-pair-${index}`,
        kind: 'definition' as const,
        content: word.definition,
      },
    ]) ?? []));
    setFlippedIds([]);
    setMatchedIds([]);
    setTurns(0);
    setLockBoard(false);
  };

  const handleFlip = (cardId: string) => {
    if (lockBoard || flippedIds.includes(cardId) || matchedIds.includes(cardId) || isRoundFinished) return;

    const nextFlipped = [...flippedIds, cardId];
    setFlippedIds(nextFlipped);

    if (nextFlipped.length < 2) return;

    setLockBoard(true);
    setTurns((count) => count + 1);

    const [firstId, secondId] = nextFlipped;
    const firstCard = deck.find((card) => card.id === firstId);
    const secondCard = deck.find((card) => card.id === secondId);
    const isMatch =
      firstCard &&
      secondCard &&
      firstCard.pairId === secondCard.pairId &&
      firstCard.kind !== secondCard.kind;

    window.setTimeout(() => {
      if (isMatch) {
        setMatchedIds((current) => [...current, firstId, secondId]);
      }
      setFlippedIds([]);
      setLockBoard(false);
    }, isMatch ? 520 : 920);
  };

  useEffect(() => {
    if (isAllFinished && !rewardSent.current) {
      rewardSent.current = true;
      onComplete?.();
    }
  }, [isAllFinished, onComplete]);

  if (isAllFinished) {
    return (
      <div className="celebration-panel studio-card">
        <div className="celebration-badge">
          <Star size={42} />
        </div>
        <h2 className="text-5xl font-semibold">You finished every matching round</h2>
        <p className="module-subcopy mx-auto mt-4 max-w-2xl">
          You matched all word and definition pairs across every round. Nice memory work.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm font-bold text-slate-500">
          {roundTurns.map((roundTurn, index) => (
            <span key={index} className="rounded-full bg-white px-4 py-2">
              Round {index + 1}: {roundTurn} turns
            </span>
          ))}
          <span className="rounded-full bg-white px-4 py-2">Round {roundIndex + 1}: {turns} turns</span>
        </div>
        <button type="button" onClick={handleRestartAll} className="primary-button mx-auto mt-8">
          <RotateCcw size={18} />
          Play all rounds again
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.54fr_1.46fr]">
      <aside className="studio-card">
        <div className="module-header">
          <div>
            <span className="module-pill">Memory matching</span>
            <h2 className="mt-4 text-4xl font-semibold">Flip two cards and find the pair</h2>
            <p className="module-subcopy mt-3">
              Each round shows fewer words, so the cards stay large, clear, and easy to tap.
            </p>
          </div>
        </div>

        <div className="progress-strip">
          <strong>Round {roundIndex + 1}</strong>
          <span className="text-sm font-semibold text-slate-500">{rounds.length} rounds total</span>
        </div>
        <div className="progress-bar">
          <div className="progress-value" style={{ width: `${((roundIndex + (isRoundFinished ? 1 : 0)) / rounds.length) * 100}%` }} />
        </div>

        <div className="mt-8 grid gap-4">
          <div className="studio-panel">
            <p className="eyebrow">Pairs found</p>
            <p className="text-3xl font-semibold">
              {matchedCount} / {currentRoundWords.length}
            </p>
          </div>
          <div className="studio-panel">
            <p className="eyebrow">Turns</p>
            <p className="text-3xl font-semibold">{turns}</p>
          </div>
          <div className="studio-panel">
            <p className="eyebrow">Tip</p>
            <p className="muted-copy">Try remembering where the long definition cards are before chasing the matching word cards.</p>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={handleRestartRound} className="secondary-button flex-1">
            <RotateCcw size={18} />
            Restart round
          </button>
          {isRoundFinished && roundIndex < rounds.length - 1 ? (
            <button type="button" onClick={handleNextRound} className="primary-button flex-1">
              Next round
              <ChevronRight size={18} />
            </button>
          ) : null}
        </div>
      </aside>

      <section className="studio-card flex flex-col">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Board</p>
            <h3 className="text-3xl font-semibold">Round {roundIndex + 1} matching game</h3>
          </div>
          <div className="module-pill">
            <CheckCircle size={14} />
            {matchedCount} solved
          </div>
        </div>

        <div
          className="grid flex-1 gap-4"
          style={{
            gridTemplateColumns: `repeat(${boardColumns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${boardRows}, minmax(0, 1fr))`,
            minHeight: `${boardHeight}px`,
          }}
        >
          {deck.map((card) => {
            const isMatched = matchedIds.includes(card.id);
            const isFlipped = flippedIds.includes(card.id) || isMatched;

            return (
              <button
                key={card.id}
                type="button"
                onClick={() => handleFlip(card.id)}
                disabled={isMatched || lockBoard || isRoundFinished}
                className="perspective-1000 h-full min-h-[190px] w-full text-left"
              >
                <div
                  className={`relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d] ${
                    isFlipped ? '[transform:rotateY(180deg)]' : ''
                  }`}
                >
                  <div className="absolute inset-0 rounded-[28px] border border-[rgba(209,174,214,0.35)] bg-[linear-gradient(145deg,rgba(255,129,181,0.16),rgba(223,242,255,0.24))] p-5 shadow-[var(--shadow-md)] [backface-visibility:hidden]">
                    <p className="eyebrow">Magic card</p>
                    <div className="mt-5 flex h-[calc(100%-1.6rem)] items-center justify-center rounded-[22px] border border-white/55 bg-white/58 text-center text-4xl font-extrabold text-[var(--berry)]">
                      ?
                    </div>
                  </div>

                  <div
                    className={`absolute inset-0 rounded-[28px] p-5 text-left shadow-[var(--shadow-md)] [backface-visibility:hidden] [transform:rotateY(180deg)] ${
                      card.kind === 'word'
                        ? 'border border-[rgba(114,181,255,0.24)] bg-[linear-gradient(145deg,rgba(223,242,255,0.98),rgba(255,255,255,0.95))] text-[#5d6ed2]'
                        : 'border border-[rgba(255,129,181,0.22)] bg-[linear-gradient(145deg,rgba(255,247,252,0.98),rgba(255,231,246,0.92))] text-slate-700'
                    } ${isMatched ? 'ring-2 ring-[#67c8b7]/70' : ''}`}
                  >
                    <p className="eyebrow">{card.kind === 'word' ? 'Word' : 'Meaning'}</p>
                    <div className="mt-3 flex h-[calc(100%-1.4rem)] items-center">
                      <p
                        className={`w-full ${
                          card.kind === 'word'
                            ? 'text-3xl font-extrabold'
                            : 'text-lg leading-8 font-bold md:text-xl md:leading-9'
                        }`}
                      >
                        {card.content}
                      </p>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
