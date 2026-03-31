import React, { useEffect, useState } from 'react';
import { BookOpenText, Key, Sparkles, Stars } from 'lucide-react';

export default function InputModule({
  onGenerate,
  isLoading,
}: {
  onGenerate: (apiKey: string, text: string) => void;
  isLoading: boolean;
}) {
  const [apiKey, setApiKey] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    const savedKey = localStorage.getItem('kimi_api_key');
    if (savedKey) setApiKey(savedKey);
  }, []);

  const handleSaveKey = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setApiKey(value);
    localStorage.setItem('kimi_api_key', value);
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
              Add your words and VocabMaster will turn them into cute cards, spelling play, and story adventures.
            </p>
          </div>
        </div>

        <div className="grid gap-5">
          <div>
            <label className="field-label">
              <Key size={18} />
              Kimi API Key
            </label>
            <input type="password" value={apiKey} onChange={handleSaveKey} placeholder="sk-..." className="studio-input" />
            <p className="muted-copy mt-3 text-sm">Your Kimi key is used only for Setup. Reading Lab uses a separate DeepSeek key and both stay saved in this browser only.</p>
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
                onChange={(event) => setText(event.target.value)}
              />
            </div>
            <p className="muted-copy mt-3 text-sm">Paste words on separate lines, with commas, or as word and meaning notes.</p>
          </div>

          <button
            type="button"
            onClick={() => onGenerate(apiKey, text)}
            disabled={isLoading || !text.trim() || !apiKey.trim()}
            className="primary-button w-full text-lg"
          >
            {isLoading ? (
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <>
                <Sparkles size={20} />
                Start my word garden
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
            <div className="studio-panel">2. Flip cards and spell sweet little words</div>
            <div className="studio-panel">3. Open Story Time for magical reading play</div>
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
                Setup makes the word set with Kimi. Open Story Time to make stories separately with DeepSeek.
              </p>
            </div>
          </div>
        </section>

        <section className="studio-card">
          <p className="eyebrow">Starlight cheer</p>
          <div className="cheer-strip">
            <span aria-hidden="true">🧚</span>
            <p>Every finished module adds egg coins and a little sparkle to your garden.</p>
            <Stars size={18} />
          </div>
        </section>
      </aside>
    </div>
  );
}
