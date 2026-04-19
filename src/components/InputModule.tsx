import React, { useEffect, useState } from 'react';
import { BookOpenText, LoaderCircle, RefreshCcw, ShieldCheck, Sparkles, Stars } from 'lucide-react';
import { loadTodayWordsFromNotion, NotionTodayWord } from '../services/notion';

const INPUT_TEXT_STORAGE_KEY = 'vocabmaster_input_text_v1';
const LOADED_NOTION_TEXT_STORAGE_KEY = 'vocabmaster_loaded_notion_text_v1';

function readStoredValue(key: string) {
  if (typeof window === 'undefined') return '';

  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

export default function InputModule({
  onGenerate,
  isLoading,
  onNotionWordsLoaded,
  onNotionBatchInvalidated,
}: {
  onGenerate: (text: string) => void;
  isLoading: boolean;
  onNotionWordsLoaded?: (items: NotionTodayWord[], wordsText: string) => void;
  onNotionBatchInvalidated?: () => void;
}) {
  const [text, setText] = useState(() => readStoredValue(INPUT_TEXT_STORAGE_KEY));
  const [isLoadingNotion, setIsLoadingNotion] = useState(false);
  const [notionStatus, setNotionStatus] = useState('');
  const [loadedNotionWordsText, setLoadedNotionWordsText] = useState(() => readStoredValue(LOADED_NOTION_TEXT_STORAGE_KEY));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(INPUT_TEXT_STORAGE_KEY, text);
    } catch {
      // Ignore storage write issues and keep the current session usable.
    }
  }, [text]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LOADED_NOTION_TEXT_STORAGE_KEY, loadedNotionWordsText);
    } catch {
      // Ignore storage write issues and keep the current session usable.
    }
  }, [loadedNotionWordsText]);

  const handleLoadTodayWords = async () => {
    setIsLoadingNotion(true);
    setNotionStatus('');

    try {
      const data = await loadTodayWordsFromNotion();
      setText(data.wordsText);
      setLoadedNotionWordsText(data.wordsText);
      onNotionWordsLoaded?.(data.items, data.wordsText);
      setNotionStatus(`Loaded ${data.count} words from Notion for ${data.date}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setNotionStatus(message);
      alert(`Error loading today's Notion words.\n\n${message}`);
    } finally {
      setIsLoadingNotion(false);
    }
  };

  return (
    <div className="setup-dashboard">
      <section className="studio-card">
        <div className="module-header">
          <div>
            <span className="module-pill">
              <Sparkles size={14} />
              Build your word garden
            </span>
            <h2 className="mt-4 text-4xl font-semibold">Make a magical little word garden</h2>
            <p className="module-subcopy mt-3 max-w-2xl">
              Add your words once, then VocabMaster will generate every module in the background from Cards all the way to Story Time.
            </p>
          </div>
        </div>

        <div className="grid gap-5">
          <div className="rounded-[24px] border border-emerald-200/60 bg-emerald-50 px-5 py-4 text-emerald-900">
            <label className="field-label">
              <ShieldCheck size={18} />
              API security
            </label>
            <p className="mt-2 text-sm leading-6">
              This copy uses server-side Vercel environment variables for AI requests. No model API key is entered or stored in the browser.
            </p>
          </div>

          <div className="rounded-[24px] border border-sky-200/70 bg-sky-50 px-5 py-4 text-sky-950">
            <label className="field-label">
              <RefreshCcw size={18} />
              A2 Key 2020 单词库同步
            </label>
            <p className="mt-2 text-sm leading-6">
              从 A2 Key 2020 单词数据库提取今天要复习的单词，并自动放进下面的单词列表。
            </p>
            <button
              type="button"
              onClick={handleLoadTodayWords}
              disabled={isLoadingNotion}
              className="secondary-button mt-4"
            >
              {isLoadingNotion ? (
                <>
                  <LoaderCircle size={18} className="animate-spin" />
                  Loading from A2 Key 2020
                </>
              ) : (
                <>
                  <RefreshCcw size={18} />
                  Load today&apos;s A2 Key 2020 words
                </>
              )}
            </button>
            {notionStatus ? (
              <p className="mt-3 text-sm leading-6 text-sky-900">{notionStatus}</p>
            ) : null}
          </div>

          <div className="scroll-field">
            <div className="scroll-owl" aria-hidden="true">
              <span className="scroll-owl-star">✨</span>
              <span className="scroll-owl-body">🦉</span>
            </div>
            <label className="field-label">Word list</label>
            <div className="parchment-scroll">
              <div className="parchment-cap parchment-cap-left" aria-hidden="true" />
              <div className="parchment-cap parchment-cap-right" aria-hidden="true" />
              <textarea
                className="studio-textarea parchment-textarea"
                placeholder="brave — showing courage&#10;sparkle — shine brightly&#10;whisper — speak softly"
                value={text}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setText(nextValue);
                  if (loadedNotionWordsText && nextValue !== loadedNotionWordsText) {
                    setLoadedNotionWordsText('');
                    onNotionBatchInvalidated?.();
                    setNotionStatus('Notion batch disconnected because the word list was edited manually.');
                  }
                }}
              />
            </div>
            <p className="muted-copy mt-3 text-sm">Paste words on separate lines, with commas, or load today&apos;s review list from A2 Key 2020 单词数据库.</p>
          </div>

          <button
            type="button"
            onClick={() => onGenerate(text)}
            disabled={isLoading || !text.trim()}
            className="primary-button w-full text-lg"
          >
            {isLoading ? (
              <>
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Generating modules
              </>
            ) : (
              <>
                <Sparkles size={20} />
                Generate all modules
              </>
            )}
          </button>
        </div>
      </section>

      <aside className="setup-aside">
        <section className="studio-card">
          <div className="dream-panel-header">
            <div>
              <p className="eyebrow">Magic friends</p>
              <h3 className="text-3xl font-semibold">A tiny pastel play world waits here</h3>
            </div>
            <span className="dream-panel-rainbow" aria-hidden="true">🌈</span>
          </div>
          <div className="storybook-illustrations" aria-hidden="true">
            <span className="illustration-card">🦄📚</span>
            <span className="illustration-card">🧚</span>
            <span className="illustration-card">🐱💤</span>
            <span className="illustration-card">⭐</span>
          </div>
          <div className="mt-6 grid gap-3 text-sm font-semibold text-slate-700">
            <div className="studio-panel">1. Pick words on the parchment scroll</div>
            <div className="studio-panel">2. Tap once to generate all modules in order</div>
            <div className="studio-panel">3. Cards open first while Story Time finishes in the background</div>
          </div>
        </section>

        <section className="studio-card helpful-scroll-card">
          <div className="helpful-scroll-header">
            <div>
              <p className="eyebrow">Helpful tips</p>
              <h3 className="text-3xl font-semibold">Sweet little ways to play better</h3>
            </div>
            <span className="pencil-helper" aria-hidden="true">✏️</span>
          </div>
          <div className="helpful-scroll-body">
            <div className="helpful-scroll-pin" aria-hidden="true">⭐</div>
            <ul className="space-y-3 text-sm leading-7 text-slate-600">
              <li>8 to 20 words is a happy size for one play set.</li>
              <li>Short meanings help cards and games feel extra clear.</li>
              <li>Story Time is the best place to watch words come alive.</li>
            </ul>
          </div>
        </section>

        <section className="studio-card">
          <div className="dream-note">
            <span className="dream-note-icon" aria-hidden="true">
              <BookOpenText size={18} />
            </span>
            <div>
              <p className="eyebrow">Reading lab note</p>
              <h3 className="text-2xl font-semibold">Stories are made in Story Time</h3>
              <p className="muted-copy mt-2">
                Setup now queues Cards, Spelling, Sentence Cloze, Vocabulary in Context, and Story Time automatically with the server-side Moonshot / Kimi key.
              </p>
            </div>
          </div>
        </section>

        <section className="studio-card">
          <p className="eyebrow">Starlight cheer</p>
          <div className="cheer-strip">
            <span aria-hidden="true">🧚</span>
            <p>Every finished module helps your kitten grow while the rest of the word garden keeps building.</p>
            <Stars size={18} />
          </div>
        </section>
      </aside>
    </div>
  );
}
