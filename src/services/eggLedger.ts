export type EggLedgerEventType = 'Earn' | 'Reset' | 'Adjust';

export interface EggLedgerEventPayload {
  amount: number;
  totalAfter: number;
  label: string;
  eventType?: EggLedgerEventType;
  note?: string;
  sessionId: string;
  occurredAt?: string;
}

export interface EggLedgerSummary {
  currentTotal: number;
  latestEventAt: string;
  latestResetAt: string;
  eventCountSinceReset: number;
}

function getEggLedgerURL() {
  if (typeof window === 'undefined') {
    return 'http://localhost:47821/api/egg-ledger';
  }

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:47821/api/egg-ledger';
  }

  return `${window.location.origin}/api/egg-ledger`;
}

export async function logEggLedgerEvent(payload: EggLedgerEventPayload) {
  const response = await fetch(getEggLedgerURL(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Failed to write egg ledger event.');
  }
}

export async function loadEggLedgerSummary(): Promise<EggLedgerSummary> {
  const response = await fetch(getEggLedgerURL());
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || 'Failed to load egg ledger summary.');
  }

  return JSON.parse(text) as EggLedgerSummary;
}
