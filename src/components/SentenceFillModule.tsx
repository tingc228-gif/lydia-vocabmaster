import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, Sparkles, Stars, XCircle } from 'lucide-react';
import { LearningData, WordData } from '../types';

interface MatchCard {
  id: string;
  pairId: string;
  label: string;
  kind: 'word' | 'synonym';
}

interface MatchEffect {
  id: number;
  type: 'good' | 'bad';
  text: string;
}

interface BurstEffect {
  id: number;
  slotIndex: number;
}

const BOARD_PAIR_COUNT = 6;
const SLOT_COUNT = BOARD_PAIR_COUNT * 2;

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

function normalizePhrase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function looksBadSynonym(word: string, synonym: string, definition: string): boolean {
  const normalizedWord = normalizePhrase(word);
  const normalizedSynonym = normalizePhrase(synonym);
  const normalizedDefinition = normalizePhrase(definition);

  if (!normalizedSynonym) return true;
  if (normalizedSynonym === normalizedWord) return true;
  if (normalizedSynonym.includes(normalizedWord) || normalizedWord.includes(normalizedSynonym)) return true;
  if (normalizedSynonym.endsWith(' match') || normalizedSynonym.endsWith(' alike')) return true;
  if (normalizedSynonym.endsWith(' link') || normalizedSynonym.endsWith(' idea')) return true;
  if (normalizedDefinition && normalizedSynonym === normalizedDefinition) return true;

  const markers = ['someone', 'something', 'means', 'in a way', 'able to', 'used to', 'person', 'people'];
  if (markers.some((marker) => normalizedSynonym.includes(marker))) return true;
  if (synonym.split(/\s+/).length > 3) return true;

  return false;
}

function getPlayableSynonymCandidates(word: WordData): string[] {
  const candidates = [word.synonym];

  const cleanedDefinition = word.definition
    .replace(/^to\s+/i, '')
    .replace(/^[a-z]+\.\s*/i, '')
    .replace(/[.;:!?]+$/g, '')
    .trim();

  const definitionCandidates = cleanedDefinition
    .split(/\bor\b|,|;|\(|\)/i)
    .map((part) =>
      part
        .replace(/^someone who is\s+/i, '')
        .replace(/^someone who\s+/i, '')
        .replace(/^someone\s+/i, '')
        .replace(/^something that is\s+/i, '')
        .replace(/^something\s+/i, '')
        .replace(/^the act of\s+/i, '')
        .replace(/^in a way that is\s+/i, '')
        .replace(/^in a way that\s+/i, '')
        .replace(/^able to\s+/i, '')
        .replace(/^very\s+/i, '')
        .trim(),
    )
    .map((part) => part.replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((part) => !looksBadSynonym(word.word, part, word.definition))
    .sort((a, b) => a.split(' ').length - b.split(' ').length || a.length - b.length);

  candidates.push(...definitionCandidates);

  const uniqueCandidates = candidates
    .map((candidate) => candidate.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((candidate, index, array) => array.findIndex((item) => normalizePhrase(item) === normalizePhrase(candidate)) === index)
    .filter((candidate) => !looksBadSynonym(word.word, candidate, word.definition));

  if (uniqueCandidates.length > 0) return uniqueCandidates;

  const firstWord = word.word.split(/\s+/)[0];
  return [`${firstWord} link`];
}

function buildPlayableSynonym(word: WordData, usedSynonyms: Set<string>): string {
  const candidates = getPlayableSynonymCandidates(word);
  const uniqueCandidate = candidates.find((candidate) => !usedSynonyms.has(normalizePhrase(candidate)));
  const selected = uniqueCandidate || candidates[0];
  usedSynonyms.add(normalizePhrase(selected));
  return selected;
}

function createPairCards(word: WordData, pairIndex: number, usedSynonyms: Set<string>): MatchCard[] {
  const pairId = `pair-${pairIndex}-${word.word}`;
  const synonymLabel = buildPlayableSynonym(word, usedSynonyms);
  return [
    {
      id: `${pairId}-word`,
      pairId,
      label: word.word,
      kind: 'word',
    },
    {
      id: `${pairId}-synonym`,
      pairId,
      label: synonymLabel,
      kind: 'synonym',
    },
  ];
}

function buildInitialBoard(words: WordData[]) {
  const slots: (MatchCard | null)[] = Array.from({ length: SLOT_COUNT }, () => null);
  const initialPairs = words.slice(0, BOARD_PAIR_COUNT);
  const slotOrder = shuffle(Array.from({ length: SLOT_COUNT }, (_, index) => index));
  const usedSynonyms = new Set<string>();

  initialPairs.forEach((word, pairIndex) => {
    const [firstSlot, secondSlot] = slotOrder.slice(pairIndex * 2, pairIndex * 2 + 2);
    const [wordCard, synonymCard] = createPairCards(word, pairIndex, usedSynonyms);
    slots[firstSlot] = wordCard;
    slots[secondSlot] = synonymCard;
  });

  return {
    slots,
    nextWordIndex: initialPairs.length,
    nextPairIndex: initialPairs.length,
  };
}

export default function SentenceFillModule({
  data,
  onComplete,
}: {
  data: LearningData;
  onComplete?: () => void;
}) {
  const totalPairs = data.words.length;
  const initialBoard = useMemo(() => buildInitialBoard(data.words), [data.words]);

  const [boardCards, setBoardCards] = useState<(MatchCard | null)[]>(initialBoard.slots);
  const [nextWordIndex, setNextWordIndex] = useState(initialBoard.nextWordIndex);
  const [nextPairIndex, setNextPairIndex] = useState(initialBoard.nextPairIndex);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [vanishingPairIds, setVanishingPairIds] = useState<string[]>([]);
  const [isResolving, setIsResolving] = useState(false);
  const [effects, setEffects] = useState<MatchEffect[]>([]);
  const [burstEffects, setBurstEffects] = useState<BurstEffect[]>([]);
  const [matchedCount, setMatchedCount] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const rewardSent = useRef(false);
  const effectIdRef = useRef(0);
  const nextWordIndexRef = useRef(initialBoard.nextWordIndex);
  const matchedCountRef = useRef(0);

  useEffect(() => {
    const freshBoard = buildInitialBoard(data.words);
    setBoardCards(freshBoard.slots);
    setNextWordIndex(freshBoard.nextWordIndex);
    setNextPairIndex(freshBoard.nextPairIndex);
    setSelectedCardIds([]);
    setVanishingPairIds([]);
    setIsResolving(false);
    setEffects([]);
    setBurstEffects([]);
    setMatchedCount(0);
    setIsFinished(false);
    rewardSent.current = false;
    nextWordIndexRef.current = freshBoard.nextWordIndex;
    matchedCountRef.current = 0;
  }, [data]);

  const createEffect = (type: 'good' | 'bad', text: string) => {
    const id = effectIdRef.current++;
    setEffects((current) => [...current, { id, type, text }]);
    window.setTimeout(() => {
      setEffects((current) => current.filter((effect) => effect.id !== id));
    }, 900);
  };

  const createBurstEffects = (slotIndexes: number[]) => {
    const created = slotIndexes.map((slotIndex) => ({
      id: effectIdRef.current++,
      slotIndex,
    }));

    setBurstEffects((current) => [...current, ...created]);
    window.setTimeout(() => {
      setBurstEffects((current) => current.filter((effect) => !created.some((item) => item.id === effect.id)));
    }, 520);
  };

  const visiblePairCount = new Set(boardCards.filter(Boolean).map((card) => card!.pairId)).size;
  const waitingCount = Math.max(0, totalPairs - matchedCount - visiblePairCount);

  const finishIfDone = (nextMatchedCount: number, nextBoard: (MatchCard | null)[], nextWordCursor: number) => {
    const hasVisibleCards = nextBoard.some(Boolean);
    const hasWaitingPairs = nextWordCursor < totalPairs;

    if (nextMatchedCount >= totalPairs && !hasVisibleCards && !hasWaitingPairs) {
      setIsFinished(true);
      if (!rewardSent.current) {
        rewardSent.current = true;
        onComplete?.();
      }
    }
  };

  const refillMatchedSlots = (pairId: string, currentBoard: (MatchCard | null)[]) => {
    const matchedSlots = currentBoard
      .map((card, index) => ({ card, index }))
      .filter((entry) => entry.card?.pairId === pairId)
      .map((entry) => entry.index);

    const nextBoard = [...currentBoard];
    let nextWordCursor = nextWordIndexRef.current;
    const usedSynonyms = new Set(
      currentBoard
        .filter((card) => card?.kind === 'synonym' && card.pairId !== pairId)
        .map((card) => normalizePhrase(card!.label)),
    );

    if (nextWordCursor < totalPairs && matchedSlots.length === 2) {
      const nextWord = data.words[nextWordCursor];
      const nextCards = shuffle(createPairCards(nextWord, nextPairIndex, usedSynonyms));
      nextBoard[matchedSlots[0]] = nextCards[0];
      nextBoard[matchedSlots[1]] = nextCards[1];
      nextWordCursor += 1;
      nextWordIndexRef.current = nextWordCursor;
      setNextWordIndex(nextWordCursor);
      setNextPairIndex((current) => current + 1);
    } else {
      matchedSlots.forEach((slotIndex) => {
        nextBoard[slotIndex] = null;
      });
    }

    return { nextBoard, matchedSlots, nextWordCursor };
  };

  const handleCardClick = (card: MatchCard) => {
    if (isResolving || vanishingPairIds.includes(card.pairId) || selectedCardIds.includes(card.id)) return;

    const nextSelected = [...selectedCardIds, card.id];
    setSelectedCardIds(nextSelected);

    if (nextSelected.length < 2) return;

    setIsResolving(true);

    const [firstId, secondId] = nextSelected;
    const firstCard = boardCards.find((item) => item?.id === firstId) || null;
    const secondCard = boardCards.find((item) => item?.id === secondId) || null;

    if (!firstCard || !secondCard) {
      setSelectedCardIds([]);
      setIsResolving(false);
      return;
    }

    const isMatch = firstCard.pairId === secondCard.pairId && firstCard.kind !== secondCard.kind;

    if (!isMatch) {
      createEffect('bad', 'Not a synonym pair yet!');
      window.setTimeout(() => {
        setSelectedCardIds([]);
        setIsResolving(false);
      }, 520);
      return;
    }

    setVanishingPairIds((current) => [...current, firstCard.pairId]);
    createEffect('good', 'Pop! Perfect match!');
    const matchedSlotIndexes = boardCards
      .map((item, index) => ({ item, index }))
      .filter((entry) => entry.item?.pairId === firstCard.pairId)
      .map((entry) => entry.index);
    createBurstEffects(matchedSlotIndexes);

    window.setTimeout(() => {
      setBoardCards((currentBoard) => {
        const { nextBoard, nextWordCursor } = refillMatchedSlots(firstCard.pairId, currentBoard);
        const nextMatchedCount = matchedCountRef.current + 1;

        matchedCountRef.current = nextMatchedCount;
        setMatchedCount(nextMatchedCount);
        finishIfDone(nextMatchedCount, nextBoard, nextWordCursor);

        return nextBoard;
      });

      setVanishingPairIds((current) => current.filter((id) => id !== firstCard.pairId));
      setSelectedCardIds([]);
      setIsResolving(false);
    }, 420);
  };

  if (isFinished) {
    return (
      <div className="celebration-panel studio-card">
        <div className="celebration-badge">
          <Stars size={42} />
        </div>
        <h2 className="text-5xl font-semibold">Synonym sparkle complete</h2>
        <p className="module-subcopy mx-auto mt-4 max-w-2xl">
          You matched every word with its synonym and cleared the whole board.
        </p>
        <button
          type="button"
          onClick={() => {
            const freshBoard = buildInitialBoard(data.words);
            setBoardCards(freshBoard.slots);
            setNextWordIndex(freshBoard.nextWordIndex);
            setNextPairIndex(freshBoard.nextPairIndex);
            setSelectedCardIds([]);
            setVanishingPairIds([]);
            setIsResolving(false);
            setEffects([]);
            setBurstEffects([]);
            setMatchedCount(0);
            setIsFinished(false);
            rewardSent.current = false;
            nextWordIndexRef.current = freshBoard.nextWordIndex;
            matchedCountRef.current = 0;
          }}
          className="primary-button mx-auto mt-8"
        >
          <CheckCircle size={18} />
          Play again
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.52fr_1.48fr]">
      <aside className="studio-card">
        <div className="module-header">
          <div>
            <span className="module-pill">Synonym sparkle</span>
            <h2 className="mt-4 text-4xl font-semibold">Match each word with its synonym</h2>
            <p className="module-subcopy mt-3">
              A correct pair pops away, and a new word pair appears in the same spot right after.
            </p>
          </div>
        </div>

        <div className="progress-strip">
          <strong>Board live</strong>
          <span className="text-sm font-semibold text-slate-500">{waitingCount} pairs waiting</span>
        </div>
        <div className="progress-bar">
          <div className="progress-value" style={{ width: `${(matchedCount / totalPairs) * 100}%` }} />
        </div>

        <div className="mt-8 grid gap-4">
          <div className="studio-panel">
            <p className="eyebrow">Pairs matched</p>
            <p className="text-3xl font-semibold">{matchedCount}</p>
          </div>
          <div className="studio-panel">
            <p className="eyebrow">Pairs on board</p>
            <p className="text-3xl font-semibold">{visiblePairCount}</p>
          </div>
          <div className="studio-panel">
            <p className="eyebrow">Egg reward</p>
            <p className="text-3xl font-semibold text-[#f7df9f]">+5</p>
          </div>
        </div>
      </aside>

      <section className="studio-card">
        <div className="module-header">
          <div>
            <span className="module-pill">Match board</span>
            <h3 className="mt-4 text-3xl font-semibold">Tap one word and one synonym</h3>
          </div>
        </div>

        {effects.length > 0 ? (
          <div className="mb-6 flex justify-center">
            {effects.map((effect) => (
              <div
                key={effect.id}
                className={`flex items-center gap-3 rounded-full px-6 py-3 text-lg font-black shadow-[0_16px_34px_rgba(8,7,28,0.32)] ${
                  effect.type === 'good'
                    ? 'bg-[linear-gradient(135deg,rgba(255,211,108,0.98),rgba(130,247,209,0.94))] text-[#2a2d0e]'
                    : 'bg-[linear-gradient(135deg,rgba(255,140,168,0.98),rgba(255,87,120,0.92))] text-white'
                }`}
              >
                {effect.type === 'good' ? <Sparkles size={18} /> : <XCircle size={18} />}
                {effect.text}
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {boardCards.map((card, slotIndex) => {
            const activeBursts = burstEffects.filter((effect) => effect.slotIndex === slotIndex);

            if (!card) {
              return (
                <div
                  key={`empty-${slotIndex}`}
                  className="min-h-[138px] rounded-[28px] border border-dashed border-white/10 bg-white/[0.03]"
                />
              );
            }

            const isSelected = selectedCardIds.includes(card.id);
            const isVanishing = vanishingPairIds.includes(card.pairId);

            return (
              <button
                key={card.id}
                type="button"
                onClick={() => handleCardClick(card)}
                disabled={isResolving && !isSelected}
                className={`choice-card relative flex min-h-[138px] items-center justify-center overflow-hidden rounded-[28px] border px-5 py-5 text-center shadow-[0_12px_24px_rgba(8,7,28,0.28)] transition-all duration-300 ${
                  isSelected
                    ? 'border-[#ffd36c]/50 bg-[linear-gradient(135deg,rgba(255,211,108,0.22),rgba(159,142,240,0.22))] text-white scale-[1.02]'
                    : 'border-white/14 bg-[linear-gradient(135deg,rgba(255,255,255,0.18),rgba(159,142,240,0.18))] text-white hover:scale-[1.02]'
                } ${isVanishing ? 'scale-110 opacity-0 blur-[2px]' : ''}`}
                style={{
                  fontSize: 'clamp(1.35rem, 1.75vw, 2.05rem)',
                  fontWeight: 900,
                  lineHeight: 1.08,
                  letterSpacing: '-0.03em',
                }}
              >
                <span
                  className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${
                    card.kind === 'word' ? 'bg-[#ffd36c]/18 text-[#ffe59c]' : 'bg-[#9bc9ff]/16 text-[#d8e8ff]'
                  }`}
                >
                  {card.kind}
                </span>
                {card.label}
                {activeBursts.map((burst) => (
                  <span key={burst.id} className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="relative block h-28 w-28 animate-[ping_500ms_ease-out_1] rounded-full bg-[radial-gradient(circle,rgba(255,214,107,0.95)_0%,rgba(255,132,189,0.7)_38%,rgba(136,224,216,0.45)_62%,transparent_78%)]" />
                    <span className="absolute h-36 w-36 animate-[spin_520ms_linear_1] rounded-full opacity-85">
                      <span className="absolute left-1/2 top-0 h-10 w-[3px] -translate-x-1/2 rounded-full bg-[#ffd36c]" />
                      <span className="absolute bottom-0 left-1/2 h-10 w-[3px] -translate-x-1/2 rounded-full bg-[#ff82c7]" />
                      <span className="absolute left-0 top-1/2 h-[3px] w-10 -translate-y-1/2 rounded-full bg-[#9bc9ff]" />
                      <span className="absolute right-0 top-1/2 h-[3px] w-10 -translate-y-1/2 rounded-full bg-[#89e0d8]" />
                      <span className="absolute left-[16%] top-[16%] h-8 w-[3px] rotate-45 rounded-full bg-[#ffe59c]" />
                      <span className="absolute bottom-[16%] right-[16%] h-8 w-[3px] rotate-45 rounded-full bg-[#ffd36c]" />
                      <span className="absolute right-[16%] top-[16%] h-8 w-[3px] -rotate-45 rounded-full bg-[#ff82c7]" />
                      <span className="absolute bottom-[16%] left-[16%] h-8 w-[3px] -rotate-45 rounded-full bg-[#9bc9ff]" />
                    </span>
                    {[
                      { x: '-78px', y: '-28px', color: '#ffd36c' },
                      { x: '-62px', y: '34px', color: '#ff82c7' },
                      { x: '-18px', y: '-70px', color: '#9bc9ff' },
                      { x: '24px', y: '-76px', color: '#89e0d8' },
                      { x: '74px', y: '-18px', color: '#ffe59c' },
                      { x: '80px', y: '24px', color: '#ff9ed0' },
                      { x: '36px', y: '72px', color: '#9bc9ff' },
                      { x: '-34px', y: '76px', color: '#89e0d8' },
                    ].map((particle, index) => (
                      <span
                        key={`${burst.id}-particle-${index}`}
                        className="synonym-burst-particle"
                        style={{
                          ['--burst-x' as '--burst-x']: particle.x,
                          ['--burst-y' as '--burst-y']: particle.y,
                          ['--burst-color' as '--burst-color']: particle.color,
                        }}
                      />
                    ))}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
