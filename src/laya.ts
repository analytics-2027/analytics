// Client du serveur Laya local (`npm run laya`), joint via le proxy Vite `/laya` -> 127.0.0.1:8765.
// Tout est facultatif : sans serveur, l'application garde ses moteurs locaux.

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export interface ChoiceAnswer {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export type LayaStatus = 'off' | 'checking' | 'online' | 'error';

export class LayaClient {
  status: LayaStatus = 'checking';
  lastMs = 0;
  private cache = new Map<string, Promise<Record<string, ChoiceAnswer> | null>>();
  private listeners: (() => void)[] = [];

  onStatus(fn: () => void): void {
    this.listeners.push(fn);
  }

  private set(s: LayaStatus) {
    if (s === this.status) return;
    this.status = s;
    this.listeners.forEach((f) => f());
  }

  async check(): Promise<void> {
    try {
      const r = await fetch('/laya/health', { signal: AbortSignal.timeout(1500) });
      this.set(r.ok ? 'online' : 'off');
    } catch {
      this.set('off');
    }
  }

  async ask(state: string, questions: Record<string, ChoiceQuestion>): Promise<Record<string, ChoiceAnswer> | null> {
    if (this.status !== 'online') return null;
    const key = state + JSON.stringify(questions);
    let p = this.cache.get(key);
    if (!p) {
      p = this.post(state, questions);
      this.cache.set(key, p);
      void p.then((v) => (v ? undefined : this.cache.delete(key)));
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  private async post(state: string, questions: Record<string, ChoiceQuestion>): Promise<Record<string, ChoiceAnswer> | null> {
    const t0 = performance.now();
    try {
      const r = await fetch('/laya/v1/systemone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, questions, model: 'english' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      this.lastMs = performance.now() - t0;
      this.listeners.forEach((f) => f());
      return j.answers as Record<string, ChoiceAnswer>;
    } catch {
      this.set('error');
      setTimeout(() => void this.check(), 3000);
      return null;
    }
  }
}
