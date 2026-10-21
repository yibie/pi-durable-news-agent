// Client-side feed reducer: news cards (oldest first), sweeps, open taste questions, picks in the basket, agent state
// and usage, from the REST snapshot plus feed.*, sweep, taste.question, pick, agent.state and usage frames. Timelines
// are views over the news cards that share a timeline id.
import type { AgentState, Card, Frame, TopicPick, Sweep, TasteQuestion, UsageDay } from "./api.ts";
import { Emitter } from "./agent-model.ts";

export interface FeedViewState {
  news: Card[];
  sweeps: Sweep[];
  questions: TasteQuestion[];
  /** Picks that are still being worked on (not dropped), newest first. */
  picks: TopicPick[];
  agent?: AgentState;
  usage?: UsageDay;
}

export class FeedModel extends Emitter {
  private cards = new Map<number, Card>();
  private sweeps = new Map<number, Sweep>();
  private questions = new Map<number, TasteQuestion>();
  private picks = new Map<number, TopicPick>();
  state: FeedViewState = { news: [], sweeps: [], questions: [], picks: [] };

  /** Merge REST pages (GET /v1/feed, /v1/sweeps, /v1/taste-questions, /v1/picks). */
  load(data: {
    cards?: Card[];
    sweeps?: Sweep[];
    questions?: TasteQuestion[];
    picks?: TopicPick[];
    agent?: AgentState;
  }) {
    for (const c of data.cards ?? []) this.cards.set(c.id, c);
    for (const s of data.sweeps ?? []) this.sweeps.set(s.id, s);
    for (const q of data.questions ?? []) this.questions.set(q.id, q);
    for (const p of data.picks ?? []) this.picks.set(p.id, p);
    if (data.agent) this.state.agent = data.agent;
    this.rebuild();
  }

  apply(frame: Frame): boolean {
    switch (frame.type) {
      case "feed.card":
      case "feed.card_updated":
      case "ui.highlight":
        this.cards.set(frame.card.id, frame.card);
        break;
      case "sweep":
        this.sweeps.set(frame.sweep.id, frame.sweep);
        break;
      case "taste.question":
        this.questions.set(frame.question.id, frame.question);
        break;
      case "pick":
        this.picks.set(frame.pick.id, frame.pick);
        break;
      case "agent.state":
        this.state.agent = frame.state;
        break;
      case "usage":
        this.state.usage = frame.usage;
        break;
      case "schedule":
        if (this.state.agent)
          this.state.agent = {
            ...this.state.agent,
            schedule: frame.schedule,
            nextSweepAt: frame.schedule.nextSweepAt,
          };
        break;
      default:
        return false;
    }
    this.rebuild();
    return true;
  }

  card(id: number): Card | undefined {
    return this.cards.get(id);
  }

  /** The active pick a card is in, if any (a card sits in at most one). */
  pickOf(cardId: number): TopicPick | undefined {
    return this.state.picks.find((p) => p.items.some((i) => i.cardId === cardId));
  }

  /** The cards of one timeline that this model holds, in timeline order. */
  timeline(id: number): Card[] {
    return [...this.cards.values()]
      .filter((c) => c.timeline?.id === id)
      .sort((a, b) => a.timeline!.index - b.timeline!.index);
  }

  private rebuild() {
    const cards = [...this.cards.values()].sort((a, b) => a.id - b.id);
    this.state = {
      ...this.state,
      news: cards.filter((c) => c.kind === "news" && !c.hiddenFromFeed),
      sweeps: [...this.sweeps.values()].sort((a, b) => a.id - b.id),
      questions: [...this.questions.values()]
        .filter((q) => q.status === "open")
        .sort((a, b) => a.id - b.id),
      picks: [...this.picks.values()]
        .filter((p) => p.status !== "dropped")
        .sort((a, b) => b.id - a.id),
    };
    this.emit();
  }
}
