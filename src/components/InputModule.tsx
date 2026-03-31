import React, { useEffect, useState } from 'react';
import { FileText, Key, Sparkles } from 'lucide-react';

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
    <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
      <section className="studio-card">
        <div className="module-header">
          <div>
            <span className="module-pill">
              <Sparkles size={14} />
              Build your study set
            </span>
            <h2 className="mt-4 text-4xl font-semibold">Make a fresh word adventure</h2>
            <p className="module-subcopy mt-3 max-w-2xl">
              Add your words, choose how many stories you want, and VocabMaster will turn them into cards, games,
              and reading practice.
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

          <div className="studio-panel">
            <p className="eyebrow">Reading lab note</p>
            <h3 className="text-2xl font-semibold">Stories are generated inside Reading Lab</h3>
            <p className="muted-copy mt-2">
              Setup creates the word study set with Kimi. Open Reading Lab to generate fill-in-the-blank stories separately with DeepSeek.
            </p>
          </div>

          <div>
            <label className="field-label">Word list</label>
            <textarea
              className="studio-textarea"
              placeholder="brave, sparkle, whisper, moonlight..."
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <p className="muted-copy mt-3 text-sm">You can paste words with commas, lines, or even a short note.</p>
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
                Create my study set
              </>
            )}
          </button>
        </div>
      </section>

      <aside className="grid gap-5">
        <section className="studio-card">
          <p className="eyebrow">What happens next</p>
          <h3 className="text-3xl font-semibold">Your words turn into a mini learning world</h3>
          <div className="mt-6 grid gap-3 text-sm font-semibold text-slate-700">
            <div className="studio-panel">1. Flashcards for quick memory</div>
            <div className="studio-panel">2. Spelling and matching games</div>
            <div className="studio-panel">3. Sentence practice and Reading Lab</div>
          </div>
        </section>

        <section className="studio-card">
          <p className="eyebrow">Helpful tips</p>
          <ul className="space-y-3 text-sm leading-7 text-slate-600">
            <li>8 to 20 words is a great size for one study set.</li>
            <li>Words with related meanings make the games more fun.</li>
            <li>Reading Lab is the best place to see the words in real context.</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
