// Publishing: the reader posts a ready pick (or rehearses it: everything but the click), sees where publishing stands
// (the 30 minute spacing, the pick's ledger line, a running publish), reads the ledger, and acks a pending or unknown
// publish after checking X.
import { int, optInt } from "../errors.ts";
import { bodyOf, bool, num, str, type Handlers, type RouteDeps } from "./types.ts";

export function publishingRoutes({
  app,
}: RouteDeps): Handlers<"picks.publish" | "publish.state" | "ledger.list" | "picks.ack"> {
  return {
    "picks.publish": (req, res) => {
      const body = bodyOf(req);
      const state = app.publisher.publish(int(req.params.id, "id"), {
        override: str(body, "override", { max: 500, optional: true }),
        rehearsal: bool(body, "rehearsal"),
      });
      res.status(202).json(state);
    },
    "publish.state": (req, res) => {
      res.json(app.publisher.state(optInt(req.query.pickId, "pickId")));
    },
    "ledger.list": (req, res) => {
      const limit = optInt(req.query.limit, "limit") ?? 50;
      res.json(app.store.ledger.list(Math.min(Math.max(limit, 1), 500)));
    },
    "picks.ack": (req, res) => {
      const note = str(bodyOf(req), "note", { max: 500 });
      res.json(app.publisher.ack(int(req.params.id, "id"), note));
    },
  };
}
