import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  CheckSquare,
  Cloud,
  Edit3,
  FileText,
  Layers,
  RotateCcw,
  Settings,
  Stars,
  Type,
} from 'lucide-react';
import InputModule from './components/InputModule';
import FlashcardsModule from './components/FlashcardsModule';
import ContextMatchingModule from './components/ContextMatchingModule';
import SentenceFillModule from './components/SentenceFillModule';
import ReadingModule from './components/ReadingModule';
import SpellingModule from './components/SpellingModule';
import { LearningData } from './types';
import { generateMaterials, regenerateStoryArticles } from './services/ai';

type TabId = 'input' | 'flashcards' | 'spelling' | 'context' | 'sentence' | 'reading';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('input');
  const [learningData, setLearningData] = useState<LearningData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegeneratingStories, setIsRegeneratingStories] = useState(false);
  const [eggCoins, setEggCoins] = useState(() => Number(localStorage.getItem('egg_coin_total') || '0'));
  const [rewardState, setRewardState] = useState({
    spelling: false,
    matching: false,
    sentence: false,
    readingArticles: [] as number[],
  });
  const [lastReward, setLastReward] = useState<string>('');
  const [rewardPopup, setRewardPopup] = useState<{ amount: number; label: string } | null>(null);

  const addEggCoins = (amount: number, label: string) => {
    if (amount <= 0) return;
    setEggCoins((current) => {
      const next = current + amount;
      localStorage.setItem('egg_coin_total', String(next));
      return next;
    });
    setLastReward(`+${amount} eggs from ${label}`);
    setRewardPopup({ amount, label });
    window.setTimeout(() => {
      setRewardPopup((current) => (current?.label === label && current.amount === amount ? null : current));
    }, 2200);
  };

  const handleGenerate = async (apiKey: string, wordsText: string) => {
    setIsLoading(true);
    try {
      const data = await generateMaterials(apiKey, wordsText);
      setLearningData(data);
      setRewardState({
        spelling: false,
        matching: false,
        sentence: false,
        readingArticles: [],
      });
      setLastReward('');
      setActiveTab('reading');
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Error generating learning materials.\n\n${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetEggCoins = () => {
    setEggCoins(0);
    localStorage.setItem('egg_coin_total', '0');
    setLastReward('Egg coins reset to 0');
  };

  const handleRegenerateStories = async (apiKey: string, storyCount: number) => {
    if (!learningData) return;

    setIsRegeneratingStories(true);
    try {
      const articles = await regenerateStoryArticles(apiKey, learningData, storyCount);
      setLearningData((current) => (current ? { ...current, articles } : current));
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Error regenerating stories.\n\n${message}`);
    } finally {
      setIsRegeneratingStories(false);
    }
  };

  const tabs = [
    { id: 'input' as const, icon: Settings, label: 'Setup', accent: 'Pick your words' },
    { id: 'flashcards' as const, icon: Layers, label: 'Cards', accent: 'Flip and smile' },
    { id: 'spelling' as const, icon: Type, label: 'Spelling', accent: 'Type the word' },
    { id: 'context' as const, icon: CheckSquare, label: 'Matching', accent: 'Find the pair' },
    { id: 'sentence' as const, icon: Edit3, label: 'Synonym Game', accent: 'Tap a match' },
    { id: 'reading' as const, icon: FileText, label: 'Story Time', accent: 'Read and play' },
  ];

  const activeTabInfo = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
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
              <span className="storybook-emoji" aria-hidden="true">🦄</span>
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
              <p>A cozy playland for cards, spelling, matching, and story fun.</p>
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
              <div className="reading-badge">
                <img src="/egg-coin-icon.jpg" alt="Egg coin" className="h-5 w-5 shrink-0 rounded-full object-cover" style={{ width: '20px', height: '20px' }} />
                {eggCoins} eggs
              </div>
              <button
                type="button"
                onClick={handleResetEggCoins}
                className="ghost-button"
              >
                <RotateCcw size={16} />
                Reset eggs
              </button>
              {activeTab === 'reading' && (
                <div className="reading-badge">
                  <Stars size={16} />
                  Story sparkles
                </div>
              )}
              <div className="status-pill">
                <span className={`status-dot ${learningData ? 'is-live' : ''}`} />
                {learningData ? 'Ready to play' : 'Start with setup'}
              </div>
            </div>
          </section>

          <section className="content-canvas">
            {activeTab === 'input' && <InputModule onGenerate={handleGenerate} isLoading={isLoading} />}
            {activeTab === 'flashcards' && learningData && <FlashcardsModule data={learningData} />}
            {activeTab === 'spelling' && learningData && (
              <SpellingModule
                data={learningData}
                onComplete={(usedHint) => {
                  if (rewardState.spelling) return;
                  addEggCoins(usedHint ? 5 : 10, 'Spelling');
                  setRewardState((current) => ({ ...current, spelling: true }));
                }}
              />
            )}
            {activeTab === 'context' && learningData && (
              <ContextMatchingModule
                data={learningData}
                onComplete={() => {
                  if (rewardState.matching) return;
                  addEggCoins(5, 'Matching');
                  setRewardState((current) => ({ ...current, matching: true }));
                }}
              />
            )}
            {activeTab === 'sentence' && learningData && (
              <SentenceFillModule
                data={learningData}
                onComplete={() => {
                  if (rewardState.sentence) return;
                  addEggCoins(5, 'Sentence Fill');
                  setRewardState((current) => ({ ...current, sentence: true }));
                }}
              />
            )}
            {activeTab === 'reading' && learningData && (
              <ReadingModule
                data={learningData}
                onRegenerateStories={handleRegenerateStories}
                isRegeneratingStories={isRegeneratingStories}
                onArticleScored={(articleIndex, mistakes) => {
                  if (rewardState.readingArticles.includes(articleIndex)) return;
                  const reward = mistakes === 0 ? 10 : mistakes <= 2 ? 5 : 0;
                  if (reward > 0) addEggCoins(reward, `Reading Lab Story ${articleIndex + 1}`);
                  setRewardState((current) => ({
                    ...current,
                    readingArticles: [...current.readingArticles, articleIndex],
                  }));
                }}
              />
            )}
          </section>
          {lastReward ? <p className="mt-4 text-sm font-bold text-[#f7df9f]">{lastReward}</p> : null}
        </main>
      </div>

      {rewardPopup ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="rounded-[28px] border border-[#ffd36c]/30 bg-[linear-gradient(135deg,rgba(41,33,95,0.96),rgba(91,73,183,0.94))] px-8 py-7 text-center shadow-[0_24px_60px_rgba(9,8,30,0.42)]">
            <p className="eyebrow !text-[#ffe59c]">Reward unlocked</p>
            <img src="/egg-coin-icon.jpg" alt="Egg coin" className="mx-auto mt-4 h-16 w-16 rounded-full object-cover shadow-[0_12px_24px_rgba(9,8,30,0.28)]" />
            <h3 className="mt-3 text-4xl font-semibold text-white">You earned {rewardPopup.amount} egg coins</h3>
            <p className="mt-3 text-lg font-bold text-white/80">From {rewardPopup.label}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
