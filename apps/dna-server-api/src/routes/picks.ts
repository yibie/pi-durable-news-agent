// Picks: the reader chooses cards to write about, with a genre, and groups several cards into a roundup. Picking a
// card counts as Show me more once (a card already voted more is not nudged again); dropping a pick or taking a card
// out of a roundup puts the cards back into News and moves no weights. Dismissing a candidate, one card or a clear of the
// whole list, takes it out of News and moves no weights either: Show me less is the only signal that lowers them.
import { PICK_GENRES, PICK_STATUSES, type Card, type TopicPick } from "@dna/sdk";
import type { PickCard } from "../db/repos/picks.ts";
import { int, invalid, notFound } from "../errors.ts";
import { applyFeedback } from "../news/taste.ts";
import { readyProblems } from "../writing/drafts.ts";
import { bodyOf, num, oneOf, str, type Handlers, type RouteDeps } from "./types.ts";

const asPickCard = (card: Card): PickCard => ({
  id: card.id,
  url: card.url,
  title: card.title,
  sourceName: card.sourceName,
});

export function pickRoutes({
  app,
}: RouteDeps): Handlers<
  "picks.list" | "picks.create" | "picks.update" | "cards.dismiss" | "feed.clear"
> {
  const { store } = app;

  /** A card the reader can pick: it exists and is not already in a pick that is still being worked on. */
  const pickable = (cardId: number, except?: number): Card => {
    const card = store.news.card(cardId);
    if (!card) throw notFound(`No card ${cardId}`);
    const holder = store.picks.activeFor(cardId);
    if (holder && holder.id !== except)
      throw invalid(`Card ${cardId} is already in pick ${holder.id}`);
    return card;
  };

  /** Picking counts as Show me more, once per card. */
  const nudge = (card: Card) => {
    if (card.feedback?.signal === "more") return;
    applyFeedback(store, card, { signal: "more" });
    app.bus.publish({ type: "feed.card_updated", card: store.news.card(card.id)! });
  };

  const publish = (pick: TopicPick) => {
    app.bus.publish({ type: "pick", pick });
    return pick;
  };

  return {
    "cards.dismiss": (req, res) => {
      const id = int(req.params.id, "id");
      const card = store.news.card(id);
      if (!card || card.kind !== "news") throw notFound(`No news card ${id}`);
      const holder = store.picks.activeFor(id);
      if (holder) throw invalid(`Card ${id} is in pick ${holder.id}; drop it from the pick first`);
      const dismissed = store.news.dismissCard(id)!;
      app.log.info("cards.dismiss", { cardId: id });
      app.bus.publish({ type: "feed.card_updated", card: dismissed });
      res.json(dismissed);
    },
    "feed.clear": (req, res) => {
      const body = bodyOf(req);
      const hours = num(body, "olderThanHours", { min: 1, max: 24 * 365 });
      const keep = new Set(store.picks.list().flatMap((p) => p.items.map((i) => i.cardId)));
      const before =
        hours === undefined ? undefined : new Date(Date.now() - hours * 3_600_000).toISOString();
      const dismissed = store.news.dismissCandidates({ before, keep });
      for (const id of dismissed)
        app.bus.publish({ type: "feed.card_updated", card: store.news.card(id)! });
      app.log.info("feed.clear", { olderThanHours: hours, count: dismissed.length });
      res.json({ dismissed });
    },
    "picks.list": (req, res) => {
      const status =
        oneOf(req.query.status, "status", ["active", "all"] as const, true) ?? "active";
      res.json(store.picks.list(status === "all"));
    },
    "picks.create": (req, res) => {
      const body = bodyOf(req);
      const genre = oneOf(body.genre, "genre", PICK_GENRES)!;
      if (!Array.isArray(body.cardIds) || body.cardIds.length === 0)
        throw invalid("cardIds must be a non empty list of card ids");
      const ids = [...new Set(body.cardIds.map((v) => int(v, "cardIds")))];
      if (genre !== "roundup" && ids.length > 1)
        throw invalid(`A ${genre} pick holds one card; use genre roundup for several`);
      const cards = ids.map((id) => pickable(id));
      const pick = store.picks.create(
        genre,
        cards.map(asPickCard),
        str(body, "title", { max: 200, optional: true }),
      );
      for (const card of cards) nudge(card);
      app.log.info("picks.create", { pickId: pick.id, genre, cardIds: ids });
      res.json(publish(pick));
    },
    "picks.update": (req, res) => {
      const id = int(req.params.id, "id");
      const current = store.picks.get(id);
      if (!current) throw notFound(`No pick ${id}`);
      const body = bodyOf(req);
      const genre = oneOf(body.genre, "genre", PICK_GENRES, true);
      const status = oneOf(body.status, "status", PICK_STATUSES, true);
      const title = str(body, "title", { max: 200, optional: true });
      const note = str(body, "note", { max: 2000, optional: true });
      const addCardId = num(body, "addCardId", { integer: true, min: 1 });
      const removeCardId = num(body, "removeCardId", { integer: true, min: 1 });
      if ([genre, status, title, note, addCardId, removeCardId].every((v) => v === undefined))
        throw invalid("Send genre, status, title, note, addCardId or removeCardId");
      const items = current.items.length + (addCardId ? 1 : 0) - (removeCardId ? 1 : 0);
      if ((genre ?? current.genre) !== "roundup" && items > 1)
        throw invalid(
          `A ${genre ?? current.genre} pick holds one card; use genre roundup for several`,
        );
      if (removeCardId && !current.items.some((i) => i.cardId === removeCardId))
        throw invalid(`Card ${removeCardId} is not in pick ${id}`);
      if (status === "published")
        throw invalid("A pick is marked published by publishing it, not by hand");
      if (status === "ready") {
        const problems = readyProblems(store, current);
        if (problems.length) throw invalid(`Pick ${id} is not ready: ${problems.join("; ")}`);
      }
      let pick: TopicPick | undefined = current;
      if (addCardId) {
        const card = pickable(addCardId, id);
        pick = store.picks.addItem(id, asPickCard(card));
        nudge(card);
      }
      if (removeCardId) pick = store.picks.removeItem(id, removeCardId);
      // A pick with no cards left has nothing to write about: it is dropped.
      const empty = pick && pick.items.length === 0;
      pick = store.picks.update(id, { genre, title, note, status: empty ? "dropped" : status });
      app.log.info("picks.update", {
        pickId: id,
        genre,
        status: pick?.status,
        addCardId,
        removeCardId,
      });
      res.json(publish(pick!));
    },
  };
}
