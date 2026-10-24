// Publishing: the reader posts a ready pick (or rehearses it: everything but the click), sees where publishing stands
// (the 30 minute spacing, the pick's ledger line, a running publish), reads the ledger, and acks a pending or unknown
// publish after checking X. picks.reply posts a published pick's first reply (the 原文 links) again when it did not
// go out right after the post.
import { int, optInt } from "../errors.ts";
import { bodyOf, bool, num, str, type Handlers, type RouteDeps } from "./types.ts";

export function publishingRoutes({
  app,
}: RouteDeps): Handlers<
  "picks.publish" | "picks.reply" | "publish.state" | "ledger.list" | "picks.ack"
> {
  return {
    "picks.publish": (req, res) => {
      const body = bodyOf(req);
      const state = app.publisher.publish(int(req.params.id, "id"), {
        override: str(body, "override", { max: 500, optional: true }),
        rehearsal: bool(body, "rehearsal"),
      });
      res.status(202).json(state);
    },
    "picks.reply": (req, res) => {
      const postUrl = str(bodyOf(req), "postUrl", { max: 300, optional: true });
      res.status(202).json(app.publisher.reply(int(req.params.id, "id"), postUrl));
    },
    "publish.state": (req, res) => {
      res.json(app.publisher.state(optInt(req.query.pickId, "pickId")));
    },
    "ledger.list": (req, res) => {
      const limit = optInt(req.query.limit, "limit") ?? 50;
      res.json(app.store.ledger.list(Math.min(Math.max(limit, 1), 500)));
    },
    "picks.ack": (req, res) => {
      const body = bodyOf(req);
      const note = str(body, "note", { max: 500 });
      res.json(app.publisher.ack(int(req.params.id, "id"), note, bool(body, "reply") ?? false));
    },
  };
}
