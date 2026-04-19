import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CheckSquare,
  Cloud,
  Edit3,
  FileText,
  Fish,
  Heart,
  Layers,
  RotateCcw,
  Settings,
  Sparkles,
  Stars,
  Type,
} from 'lucide-react';
import InputModule from './components/InputModule';
import FlashcardsModule from './components/FlashcardsModule';
import ContextMatchingModule from './components/ContextMatchingModule';
import SentenceFillModule from './components/SentenceFillModule';
import ReadingModule from './components/ReadingModule';
import SpellingModule from './components/SpellingModule';
import { LearningData, PetRewardEvent, PetState } from './types';
import {
  generateMaterials,
  generateNextStoryArticle,
  generateSentenceClozeModule,
  generateVocabularyInContextModule,
} from './services/ai';
import {
  loadPetStateFromNotion,
  NotionTodayWord,
  savePetStateToNotion,
  syncCompletedReviewToNotion,
} from './services/notion';

type TabId = 'input' | 'flashcards' | 'spelling' | 'context' | 'sentence' | 'reading';
type RewardState = {
  spelling: boolean;
  matching: boolean;
  sentence: boolean;
  readingArticles: number[];
};

type ModuleGenerationPhase = 'idle' | 'loading' | 'ready' | 'error';

type ModuleGenerationState = {
  cards: ModuleGenerationPhase;
  spelling: ModuleGenerationPhase;
  sentenceCloze: ModuleGenerationPhase;
  vocabularyInContext: ModuleGenerationPhase;
  storyTime: ModuleGenerationPhase;
  errorMessage: string;
};

interface PersistedAppState {
  activeTab: TabId;
  learningData: LearningData | null;
  rewardState: RewardState;
  activeNotionBatch: NotionTodayWord[];
  storyIncorrectWords: string[];
  reviewSyncStatus: string;
  reviewSynced: boolean;
}

const APP_STATE_STORAGE_KEY = 'vocabmaster_app_state_v1';
const PET_STORAGE_KEY = 'pet_state_v1';

const DEFAULT_PET_STATE: PetState = {
  foodPercent: 0,
  joyPercent: 0,
  growthPercent: 0,
  careRound: 1,
  animationState: 'resting',
};

function createDefaultRewardState(): RewardState {
  return {
    spelling: false,
    matching: false,
    sentence: false,
    readingArticles: [],
  };
}

function getTargetStoryCount(data: LearningData | null) {
  if (!data || data.words.length === 0) return 0;
  return Math.max(1, Math.ceil(data.words.length / 10));
}

function createModuleGenerationState(data: LearningData | null): ModuleGenerationState {
  const hasBaseWords = Boolean(data && data.words.length > 0);
  const targetStoryCount = getTargetStoryCount(data);

  return {
    cards: hasBaseWords ? 'ready' : 'idle',
    spelling: hasBaseWords ? 'ready' : 'idle',
    sentenceCloze: data && data.sentenceClozeQuestions.length > 0 ? 'ready' : 'idle',
    vocabularyInContext: data && data.vocabularyInContextQuestions.length > 0 ? 'ready' : 'idle',
    storyTime: data && data.articles.length >= targetStoryCount && targetStoryCount > 0 ? 'ready' : 'idle',
    errorMessage: '',
  };
}

function hasPendingModuleGeneration(data: LearningData | null) {
  if (!data || data.words.length === 0) return false;
  if (data.sentenceClozeQuestions.length === 0) return true;
  if (data.vocabularyInContextQuestions.length === 0) return true;
  return data.articles.length < getTargetStoryCount(data);
}

function getGenerationStatusLabel(isLoading: boolean, moduleGeneration: ModuleGenerationState, hasLearningData: boolean) {
  if (isLoading) return 'Generating Cards first';
  if (moduleGeneration.sentenceCloze === 'loading') return 'Generating Sentence Cloze';
  if (moduleGeneration.vocabularyInContext === 'loading') return 'Generating Vocabulary in Context';
  if (moduleGeneration.storyTime === 'loading') return 'Generating Story Time';
  if (moduleGeneration.errorMessage) return 'Some modules need retry';
  return hasLearningData ? 'Ready to play' : 'Start with setup';
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStoredJSON<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJSON(key: string, value: unknown) {
  if (!canUseStorage()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors and keep the app usable.
  }
}

function normalizePersistedLearningData(value: PersistedAppState['learningData'] | Partial<LearningData> | null): LearningData | null {
  if (!value) return null;

  return {
    words: Array.isArray(value.words) ? value.words : [],
    articles: Array.isArray(value.articles) ? value.articles : [],
    sentenceClozeQuestions: Array.isArray((value as Partial<LearningData>).sentenceClozeQuestions)
      ? (value as Partial<LearningData>).sentenceClozeQuestions || []
      : [],
    vocabularyInContextQuestions: Array.isArray((value as Partial<LearningData>).vocabularyInContextQuestions)
      ? (value as Partial<LearningData>).vocabularyInContextQuestions || []
      : [],
  };
}

function readPersistedAppState(): PersistedAppState {
  const stored = readStoredJSON<Partial<PersistedAppState>>(APP_STATE_STORAGE_KEY, {});
  const learningData = normalizePersistedLearningData(stored.learningData ?? null);
  const activeTab = stored.activeTab ?? 'input';

  return {
    activeTab: learningData ? activeTab : 'input',
    learningData,
    rewardState: stored.rewardState
      ? {
          spelling: Boolean(stored.rewardState.spelling),
          matching: Boolean(stored.rewardState.matching),
          sentence: Boolean(stored.rewardState.sentence),
          readingArticles: Array.isArray(stored.rewardState.readingArticles) ? stored.rewardState.readingArticles : [],
        }
      : createDefaultRewardState(),
    activeNotionBatch: Array.isArray(stored.activeNotionBatch) ? stored.activeNotionBatch : [],
    storyIncorrectWords: Array.isArray(stored.storyIncorrectWords) ? stored.storyIncorrectWords : [],
    reviewSyncStatus: typeof stored.reviewSyncStatus === 'string' ? stored.reviewSyncStatus : '',
    reviewSynced: Boolean(stored.reviewSynced),
  };
}

function loadPetState(): PetState {
  if (!canUseStorage()) return DEFAULT_PET_STATE;

  try {
    const raw = window.localStorage.getItem(PET_STORAGE_KEY);
    if (!raw) return DEFAULT_PET_STATE;

    const parsed = JSON.parse(raw) as Partial<PetState>;
    return {
      foodPercent: Number(parsed.foodPercent) || 0,
      joyPercent: Number(parsed.joyPercent) || 0,
      growthPercent: Number(parsed.growthPercent) || 0,
      careRound: Math.max(1, Number(parsed.careRound) || 1),
      animationState: 'resting',
    };
  } catch {
    return DEFAULT_PET_STATE;
  }
}

function getGrowthGain(foodPercent: number, joyPercent: number) {
  if (foodPercent < 5 || joyPercent < 10) return 0;
  if (foodPercent >= 30) return 20;
  if (foodPercent >= 20) return 15;
  if (foodPercent >= 10) return 10;
  return 5;
}

function createPetSnapshot(petState: Pick<PetState, 'foodPercent' | 'joyPercent' | 'growthPercent' | 'careRound'>) {
  return {
    foodPercent: petState.foodPercent,
    joyPercent: petState.joyPercent,
    growthPercent: petState.growthPercent,
    careRound: petState.careRound,
  };
}

function serializePetSnapshot(petState: Pick<PetState, 'foodPercent' | 'joyPercent' | 'growthPercent' | 'careRound'>) {
  return JSON.stringify(createPetSnapshot(petState));
}

function PetStatusPanel({
  petState,
  onReset,
}: {
  petState: PetState;
  onReset: () => void;
}) {
  const growthProgress = Math.min(petState.growthPercent, 100);
  const foodProgress = Math.min(petState.foodPercent, 30);
  const joyProgress = Math.min(petState.joyPercent, 10);
  const kittenScale = 1 + growthProgress / 250;

  return (
    <div className="pet-dashboard">
      <div className="pet-summary">
        <div>
          <p className="eyebrow mb-0">Kitten care mode</p>
          <h3>Round {petState.careRound} little cat</h3>
          <p className="pet-summary-copy">Feed, cheer, and help your kitten grow while the rest of the app follows the source project.</p>
        </div>
        <button type="button" onClick={onReset} className="ghost-button">
          <RotateCcw size={16} />
          Reset pet
        </button>
      </div>

      <div className={`pet-stage is-${petState.animationState}`}>
        <div className="pet-stage-glow" />
        <div className="pet-bowl" aria-hidden="true">
          <span className="pet-bowl-kibble" />
        </div>
        <div className="pet-heart-burst" aria-hidden="true">
          <span>♥</span>
          <span>♥</span>
          <span>♥</span>
        </div>
        <div className="pet-star-burst" aria-hidden="true">
          <span>★</span>
          <span>★</span>
          <span>★</span>
        </div>
        <div className="pet-kitten-shell" aria-hidden="true">
          <div className="pet-kitten" style={{ transform: `scale(${kittenScale})` }}>
            <span className="pet-ear pet-ear-left" />
            <span className="pet-ear pet-ear-right" />
            <span className="pet-tail" />
            <div className="pet-body">
              <div className="pet-face">
                <span className="pet-eye pet-eye-left" />
                <span className="pet-eye pet-eye-right" />
                <span className="pet-nose" />
                <span className="pet-mouth" />
              </div>
              <span className="pet-paw pet-paw-left" />
              <span className="pet-paw pet-paw-right" />
            </div>
          </div>
        </div>
      </div>

      <div className="pet-meters">
        <div className="pet-meter-card">
          <div className="pet-meter-label">
            <span>
              <Fish size={15} />
              Food
            </span>
            <strong>{petState.foodPercent}%</strong>
          </div>
          <div className="pet-meter-bar">
            <div className="pet-meter-fill is-food" style={{ width: `${(foodProgress / 30) * 100}%` }} />
          </div>
        </div>
        <div className="pet-meter-card">
          <div className="pet-meter-label">
            <span>
              <Heart size={15} />
              Joy
            </span>
            <strong>{petState.joyPercent}%</strong>
          </div>
          <div className="pet-meter-bar">
            <div className="pet-meter-fill is-joy" style={{ width: `${(joyProgress / 10) * 100}%` }} />
          </div>
        </div>
        <div className="pet-meter-card">
          <div className="pet-meter-label">
            <span>
              <Sparkles size={15} />
              Growth
            </span>
            <strong>{growthProgress}%</strong>
          </div>
          <div className="pet-meter-bar">
            <div className="pet-meter-fill is-growth" style={{ width: `${growthProgress}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [persistedAppState] = useState<PersistedAppState>(() => readPersistedAppState());
  const [activeTab, setActiveTab] = useState<TabId>(persistedAppState.activeTab);
  const [learningData, setLearningData] = useState<LearningData | null>(persistedAppState.learningData);
  const [isLoading, setIsLoading] = useState(false);
  const [moduleGeneration, setModuleGeneration] = useState<ModuleGenerationState>(() =>
    createModuleGenerationState(persistedAppState.learningData),
  );
  const [petState, setPetState] = useState<PetState>(() => loadPetState());
  const [petStateRecordId, setPetStateRecordId] = useState('');
  const [rewardState, setRewardState] = useState<RewardState>(persistedAppState.rewardState);
  const [petRewardEvent, setPetRewardEvent] = useState<PetRewardEvent | null>(null);
  const [activeNotionBatch, setActiveNotionBatch] = useState<NotionTodayWord[]>(persistedAppState.activeNotionBatch);
  const [storyIncorrectWords, setStoryIncorrectWords] = useState<string[]>(persistedAppState.storyIncorrectWords);
  const [isSyncingReview, setIsSyncingReview] = useState(false);
  const [reviewSyncStatus, setReviewSyncStatus] = useState(persistedAppState.reviewSyncStatus);
  const [reviewSynced, setReviewSynced] = useState(persistedAppState.reviewSynced);
  const generationRunIdRef = useRef(0);
  const hasResumedPersistedPipelineRef = useRef(false);
  const hasHydratedPetStateRef = useRef(false);
  const lastSyncedPetSnapshotRef = useRef(serializePetSnapshot(DEFAULT_PET_STATE));

  useEffect(() => {
    writeStoredJSON(APP_STATE_STORAGE_KEY, {
      activeTab,
      learningData,
      rewardState,
      activeNotionBatch,
      storyIncorrectWords,
      reviewSyncStatus,
      reviewSynced,
    } satisfies PersistedAppState);
  }, [activeNotionBatch, activeTab, learningData, reviewSyncStatus, reviewSynced, rewardState, storyIncorrectWords]);

  useEffect(() => {
    writeStoredJSON(PET_STORAGE_KEY, {
      ...petState,
      animationState: 'resting',
    });
  }, [petState]);

  useEffect(() => {
    let isActive = true;

    const hydratePetState = async () => {
      try {
        const petStateFromNotion = await loadPetStateFromNotion();
        if (!isActive) return;

        const syncedSnapshot = {
          foodPercent: petStateFromNotion.foodPercent,
          joyPercent: petStateFromNotion.joyPercent,
          growthPercent: petStateFromNotion.growthPercent,
          careRound: petStateFromNotion.careRound,
        };

        setPetState({
          ...syncedSnapshot,
          animationState: 'resting',
        });
        setPetStateRecordId(petStateFromNotion.id);
        lastSyncedPetSnapshotRef.current = serializePetSnapshot(syncedSnapshot);
      } catch (error) {
        console.error('Failed to hydrate pet state from Notion.', error);
      } finally {
        if (isActive) {
          hasHydratedPetStateRef.current = true;
        }
      }
    };

    void hydratePetState();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedPetStateRef.current) return;

    const petSnapshot = createPetSnapshot(petState);
    const serializedSnapshot = serializePetSnapshot(petSnapshot);
    if (serializedSnapshot === lastSyncedPetSnapshotRef.current) return;

    const timeout = window.setTimeout(async () => {
      try {
        const saved = await savePetStateToNotion({
          id: petStateRecordId || undefined,
          ...petSnapshot,
        });

        setPetStateRecordId(saved.id);
        lastSyncedPetSnapshotRef.current = serializePetSnapshot(saved);
      } catch (error) {
        console.error('Failed to save pet state to Notion.', error);
      }
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [petState.foodPercent, petState.joyPercent, petState.growthPercent, petState.careRound, petStateRecordId]);

  useEffect(() => {
    if (!petRewardEvent) return;

    const timeout = window.setTimeout(() => {
      setPetRewardEvent((current) => (current === petRewardEvent ? null : current));
    }, petRewardEvent.kind === 'care' ? 2800 : 2200);

    return () => window.clearTimeout(timeout);
  }, [petRewardEvent]);

  useEffect(() => {
    if (petState.animationState === 'resting') return;

    const timeout = window.setTimeout(() => {
      setPetState((current) =>
        current.animationState === petState.animationState
          ? { ...current, animationState: 'resting' }
          : current,
      );
    }, petState.animationState === 'growing' ? 1800 : 1200);

    return () => window.clearTimeout(timeout);
  }, [petState.animationState]);

  const applyPetReward = ({
    foodDelta = 0,
    joyDelta = 0,
    source,
  }: {
    foodDelta?: number;
    joyDelta?: number;
    source: string;
  }) => {
    if (foodDelta <= 0 && joyDelta <= 0) return;

    let nextEvent: PetRewardEvent | null = null;

    setPetState((current) => {
      const nextFood = current.foodPercent + foodDelta;
      const nextJoy = current.joyPercent + joyDelta;
      const growthGain = getGrowthGain(nextFood, nextJoy);

      if (growthGain > 0) {
        const grownTo = current.growthPercent + growthGain;
        const completedCare = grownTo >= 100;
        nextEvent = completedCare
          ? {
              kind: 'care',
              amount: growthGain,
              source,
              message: `Kitten care complete. Round ${current.careRound + 1} begins now.`,
            }
          : {
              kind: 'growth',
              amount: growthGain,
              source,
              message: `Growth +${growthGain}%`,
            };

        return {
          foodPercent: 0,
          joyPercent: 0,
          growthPercent: completedCare ? 0 : grownTo,
          careRound: completedCare ? current.careRound + 1 : current.careRound,
          animationState: 'growing',
        };
      }

      nextEvent = foodDelta > 0
        ? {
            kind: 'food',
            amount: foodDelta,
            source,
            message: `Food +${foodDelta}%`,
          }
        : {
            kind: 'joy',
            amount: joyDelta,
            source,
            message: `Joy +${joyDelta}%`,
          };

      return {
        ...current,
        foodPercent: nextFood,
        joyPercent: nextJoy,
        animationState: foodDelta > 0 ? 'feeding' : 'joyful',
      };
    });

    if (nextEvent) {
      setPetRewardEvent(nextEvent);
    }
  };

  const updateGeneratedLearningData = (nextData: LearningData) => {
    setLearningData(nextData);
  };

  const runModulePipeline = async (startingData: LearningData, runId: number) => {
    let currentData = startingData;
    let currentModule: keyof Omit<ModuleGenerationState, 'cards' | 'spelling' | 'errorMessage'> | null = null;

    const isStale = () => generationRunIdRef.current !== runId;

    try {
      if (currentData.sentenceClozeQuestions.length === 0) {
        currentModule = 'sentenceCloze';
        setModuleGeneration((current) => ({ ...current, sentenceCloze: 'loading', errorMessage: '' }));
        const sentenceClozeQuestions = await generateSentenceClozeModule(currentData);
        if (isStale()) return;

        currentData = { ...currentData, sentenceClozeQuestions };
        updateGeneratedLearningData(currentData);
        setModuleGeneration((current) => ({ ...current, sentenceCloze: 'ready' }));
      } else {
        setModuleGeneration((current) => ({ ...current, sentenceCloze: 'ready' }));
      }

      if (currentData.vocabularyInContextQuestions.length === 0) {
        currentModule = 'vocabularyInContext';
        setModuleGeneration((current) => ({ ...current, vocabularyInContext: 'loading', errorMessage: '' }));
        const vocabularyInContextQuestions = await generateVocabularyInContextModule(currentData);
        if (isStale()) return;

        currentData = { ...currentData, vocabularyInContextQuestions };
        updateGeneratedLearningData(currentData);
        setModuleGeneration((current) => ({ ...current, vocabularyInContext: 'ready' }));
      } else {
        setModuleGeneration((current) => ({ ...current, vocabularyInContext: 'ready' }));
      }

      const targetStoryCount = getTargetStoryCount(currentData);
      if (targetStoryCount > 0 && currentData.articles.length < targetStoryCount) {
        currentModule = 'storyTime';
        setModuleGeneration((current) => ({ ...current, storyTime: 'loading', errorMessage: '' }));

        while (currentData.articles.length < targetStoryCount) {
          const nextArticle = await generateNextStoryArticle(currentData);
          if (isStale()) return;

          currentData = {
            ...currentData,
            articles: [...currentData.articles, nextArticle],
          };
          updateGeneratedLearningData(currentData);
        }

        setModuleGeneration((current) => ({ ...current, storyTime: 'ready' }));
      } else {
        setModuleGeneration((current) => ({ ...current, storyTime: 'ready' }));
      }
    } catch (error) {
      if (isStale()) return;

      const message = error instanceof Error ? error.message : 'Unknown error';
      setModuleGeneration((current) => ({
        ...current,
        ...(currentModule ? { [currentModule]: 'error' as const } : {}),
        errorMessage: message,
      }));
      alert(`A background module could not finish.\n\n${message}`);
    }
  };

  useEffect(() => {
    if (hasResumedPersistedPipelineRef.current) return;
    hasResumedPersistedPipelineRef.current = true;

    if (!hasPendingModuleGeneration(persistedAppState.learningData)) return;

    const runId = generationRunIdRef.current + 1;
    generationRunIdRef.current = runId;
    setModuleGeneration(createModuleGenerationState(persistedAppState.learningData));
    void runModulePipeline(persistedAppState.learningData as LearningData, runId);
  }, [persistedAppState.learningData]);

  const handleGenerate = async (wordsText: string) => {
    const runId = generationRunIdRef.current + 1;
    generationRunIdRef.current = runId;
    setIsLoading(true);
    setModuleGeneration({
      cards: 'loading',
      spelling: 'loading',
      sentenceCloze: 'idle',
      vocabularyInContext: 'idle',
      storyTime: 'idle',
      errorMessage: '',
    });
    try {
      const data = await generateMaterials(wordsText);
      if (generationRunIdRef.current !== runId) return;

      setLearningData(data);
      setRewardState(createDefaultRewardState());
      setStoryIncorrectWords([]);
      setReviewSyncStatus('');
      setReviewSynced(false);
      setModuleGeneration({
        cards: 'ready',
        spelling: 'ready',
        sentenceCloze: data.sentenceClozeQuestions.length > 0 ? 'ready' : 'idle',
        vocabularyInContext: data.vocabularyInContextQuestions.length > 0 ? 'ready' : 'idle',
        storyTime: data.articles.length >= getTargetStoryCount(data) ? 'ready' : 'idle',
        errorMessage: '',
      });
      setActiveTab('flashcards');
      void runModulePipeline(data, runId);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (generationRunIdRef.current === runId) {
        setModuleGeneration({
          cards: 'error',
          spelling: 'error',
          sentenceCloze: 'idle',
          vocabularyInContext: 'idle',
          storyTime: 'idle',
          errorMessage: message,
        });
      }
      alert(`Error generating learning materials.\n\n${message}`);
    } finally {
      if (generationRunIdRef.current === runId) {
        setIsLoading(false);
      }
    }
  };

  const handleResetPet = () => {
    setPetState(DEFAULT_PET_STATE);
    setPetRewardEvent(null);
    if (canUseStorage()) {
      writeStoredJSON(PET_STORAGE_KEY, {
        ...DEFAULT_PET_STATE,
        animationState: 'resting',
      });
    }
  };

  const tabs = [
    { id: 'input' as const, icon: Settings, label: 'Setup', accent: 'Pick your words' },
    { id: 'flashcards' as const, icon: Layers, label: 'Cards', accent: 'Flip and smile' },
    { id: 'spelling' as const, icon: Type, label: 'Spelling', accent: 'Type the word' },
    { id: 'context' as const, icon: CheckSquare, label: 'Sentence Cloze', accent: 'Choose best fit' },
    { id: 'sentence' as const, icon: Edit3, label: 'Vocabulary in Context', accent: 'Read for meaning' },
    { id: 'reading' as const, icon: FileText, label: 'Story Time', accent: 'Read and play' },
  ];

  const activeTabInfo = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const isBackgroundGenerating =
    moduleGeneration.sentenceCloze === 'loading' ||
    moduleGeneration.vocabularyInContext === 'loading' ||
    moduleGeneration.storyTime === 'loading';
  const generationBusy = isLoading || isBackgroundGenerating;
  const generationStatusLabel = getGenerationStatusLabel(isLoading, moduleGeneration, Boolean(learningData));
  const activeBatchWordSet = useMemo(
    () => new Set(activeNotionBatch.map((item) => item.word.trim().toLowerCase()).filter(Boolean)),
    [activeNotionBatch],
  );
  const coveredReadingWordSet = useMemo(
    () => new Set((learningData?.articles || []).flatMap((article) => article.blanks.map((blank) => blank.answer.toLowerCase()))),
    [learningData],
  );
  const requiredReadingStoryCount =
    activeNotionBatch.length > 0
      ? Math.max(1, Math.ceil(activeNotionBatch.length / 10))
      : learningData?.articles.length || 0;
  const allReadingWordsCovered =
    activeBatchWordSet.size > 0
      ? Array.from(activeBatchWordSet).every((word) => coveredReadingWordSet.has(word))
      : !!learningData && coveredReadingWordSet.size >= learningData.words.length;
  const hasCompletedRequiredReadingReview =
    !!learningData &&
    learningData.articles.length >= requiredReadingStoryCount &&
    rewardState.readingArticles.length >= requiredReadingStoryCount &&
    allReadingWordsCovered;
  const hasCompletedRequiredPracticeModules = rewardState.spelling && rewardState.matching && rewardState.sentence;
  const hasCompletedNotionReviewSync = hasCompletedRequiredPracticeModules && hasCompletedRequiredReadingReview;

  useEffect(() => {
    if (!hasCompletedNotionReviewSync || activeNotionBatch.length === 0 || isSyncingReview || reviewSynced) {
      return;
    }

    const syncReview = async () => {
      setIsSyncingReview(true);
      try {
        const result = await syncCompletedReviewToNotion({
          items: activeNotionBatch,
          incorrectWords: storyIncorrectWords,
        });
        setReviewSynced(true);
        setReviewSyncStatus(
          `Notion updated: ${result.updatedCount} words marked reviewed on ${result.date}, ${result.leveledUpCount} words leveled up.`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setReviewSyncStatus(`Notion sync failed.\n${message}`);
      } finally {
        setIsSyncingReview(false);
      }
    };

    void syncReview();
  }, [activeNotionBatch, hasCompletedNotionReviewSync, isSyncingReview, reviewSynced, storyIncorrectWords]);

  const stats = useMemo(
    () => [
      { label: 'Words', value: learningData?.words?.length ?? 0 },
      { label: 'Stories', value: learningData?.articles?.length ?? 0 },
      { label: 'Games', value: tabs.length - 1 },
    ],
    [learningData],
  );

  return (
    <div className="app-shell">
      <div className="app-orb app-orb-left" />
      <div className="app-orb app-orb-right" />

      <div className="app-frame">
        <header className="top-ribbon">
          <div className="storybook-hero">
            <div className="storybook-float storybook-cloud">
              <Cloud size={18} />
              Dreamy play
            </div>
            <div className="storybook-float storybook-stars">
              <Stars size={16} />
              Magic words
            </div>

            <div className="storybook-side storybook-left">
              <span className="storybook-emoji" aria-hidden="true">🐱</span>
              <span className="storybook-emoji" aria-hidden="true">✨</span>
            </div>

            <div className="storybook-title">
              <div className="brand-lockup storybook-brand">
                <div className="brand-mark">
                  <BookOpen size={24} />
                </div>
                <div>
                  <p className="storybook-overline">Little Word Garden</p>
                  <h2>VocabMaster</h2>
                </div>
              </div>
              <p>A cozy playland for cards, spelling, exam practice, story fun, and one tiny growing kitten.</p>
            </div>

            <div className="storybook-side storybook-right">
              <div className="stats-grid storybook-stats">
                {stats.map((stat) => (
                  <div key={stat.label} className="stat-card">
                    <span>{stat.label}</span>
                    <strong>{stat.value}</strong>
                  </div>
                ))}
              </div>
            </div>

            <nav className="tab-list storybook-tabs" aria-label="Learning modules">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const disabled = !learningData && tab.id !== 'input';
                const isActive = activeTab === tab.id;
                const isReading = tab.id === 'reading';

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    disabled={disabled}
                    className={`tab-button ${isActive ? 'is-active' : ''} ${isReading ? 'is-reading' : ''}`}
                  >
                    <span className="tab-icon">
                      <Icon size={18} />
                    </span>
                    <span className="tab-text">
                      <strong>{tab.label}</strong>
                      <small>{tab.accent}</small>
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
        </header>

        <main className={`content-shell ${activeTab === 'reading' ? 'is-reading-focus' : ''}`}>
          <section className="content-topbar">
            <div>
              <p className="eyebrow">Now playing</p>
              <h2>{activeTabInfo.label}</h2>
            </div>

            <div className="topbar-right">
              {activeTab === 'reading' && (
                <div className="reading-badge">
                  <Stars size={16} />
                  Story sparkles
                </div>
              )}
              <div className="status-pill">
                <span className={`status-dot ${learningData ? 'is-live' : ''}`} />
                {generationStatusLabel}
              </div>
            </div>
          </section>

          <section className="content-canvas">
            <PetStatusPanel petState={petState} onReset={handleResetPet} />

            {activeTab === 'input' && (
              <InputModule
                onGenerate={handleGenerate}
                isLoading={generationBusy}
                onNotionWordsLoaded={(items) => {
                  setActiveNotionBatch(items);
                  setStoryIncorrectWords([]);
                  setReviewSyncStatus('');
                  setReviewSynced(false);
                }}
                onNotionBatchInvalidated={() => {
                  setActiveNotionBatch([]);
                  setStoryIncorrectWords([]);
                  setReviewSyncStatus('Notion sync paused because the loaded 20-word batch was edited manually.');
                  setReviewSynced(false);
                }}
              />
            )}
            {activeTab === 'flashcards' && learningData && <FlashcardsModule data={learningData} />}
            {activeTab === 'spelling' && learningData && (
              <SpellingModule
                data={learningData}
                onComplete={(usedHint) => {
                  if (rewardState.spelling) return;
                  applyPetReward({
                    foodDelta: usedHint ? 5 : 10,
                    source: 'Spelling',
                  });
                  setRewardState((current) => ({ ...current, spelling: true }));
                }}
              />
            )}
            {activeTab === 'context' && learningData && (
              <ContextMatchingModule
                data={learningData}
                onComplete={() => {
                  if (rewardState.matching) return;
                  applyPetReward({
                    joyDelta: 5,
                    source: 'Sentence Cloze',
                  });
                  setRewardState((current) => ({ ...current, matching: true }));
                }}
              />
            )}
            {activeTab === 'sentence' && learningData && (
              <SentenceFillModule
                data={learningData}
                onComplete={() => {
                  if (rewardState.sentence) return;
                  applyPetReward({
                    joyDelta: 5,
                    source: 'Vocabulary in Context',
                  });
                  setRewardState((current) => ({ ...current, sentence: true }));
                }}
              />
            )}
            {activeTab === 'reading' && learningData && (
              <ReadingModule
                data={learningData}
                isGeneratingStory={moduleGeneration.storyTime === 'loading'}
                expectedStoryCount={getTargetStoryCount(learningData)}
                moduleGenerationError={moduleGeneration.storyTime === 'error' ? moduleGeneration.errorMessage : ''}
                onArticleScored={(articleIndex, mistakes, incorrectWords) => {
                  if (rewardState.readingArticles.includes(articleIndex)) return;
                  const reward = mistakes === 0 ? 10 : mistakes <= 2 ? 5 : 0;
                  if (reward > 0) {
                    applyPetReward({
                      foodDelta: reward,
                      source: `Story ${articleIndex + 1}`,
                    });
                  }
                  setStoryIncorrectWords((current) => Array.from(new Set([...current, ...incorrectWords])));
                  setRewardState((current) => ({
                    ...current,
                    readingArticles: [...current.readingArticles, articleIndex],
                  }));
                }}
              />
            )}
          </section>
          {activeNotionBatch.length > 0 || reviewSyncStatus ? (
            <p className="mt-4 whitespace-pre-line text-sm font-bold text-[#c8f7da]">
              {isSyncingReview
                ? 'Syncing completed review back to Notion...'
                : reviewSyncStatus || `Notion batch ready: ${activeNotionBatch.length} words loaded from the database.`}
            </p>
          ) : null}
        </main>
      </div>

      {petRewardEvent ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="pet-reward-popup">
            <p className="eyebrow !text-[#ffe59c]">Kitten update</p>
            <h3>{petRewardEvent.message}</h3>
            <p>From {petRewardEvent.source}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
