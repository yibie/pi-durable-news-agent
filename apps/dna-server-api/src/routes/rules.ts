// The writer's rules, edited from the workbench: rules.list shows both (how to write, how to draw) as the writer reads
// them with every saved version, rules.version one old text, rules.save a new text the writer reads from its next turn.
import { WRITER_RULE_NAMES } from "@dna/sdk";
import { int, notFound } from "../errors.ts";
import { isRuleName, saveWriterRule, writerRule } from "../writing/rules.ts";
import { bodyOf, num, str, type Handlers, type RouteDeps } from "./types.ts";

export function ruleRoutes({
  app,
}: RouteDeps): Handlers<"rules.list" | "rules.version" | "rules.save"> {
  const { config, store } = app;
  return {
    "rules.list": (_req, res) => {
      res.json(WRITER_RULE_NAMES.map((name) => writerRule(config, store, name)));
    },
    "rules.version": (req, res) => {
      const id = int(req.params.id, "id");
      const version = store.rules.version(id);
      if (!version) throw notFound(`No writer rule version ${id}`);
      res.json(version);
    },
    "rules.save": (req, res) => {
      const name = String(req.params.id);
      if (!isRuleName(name)) throw notFound(`No writer rule ${name}: use RULES or ARGMAP`);
      const body = bodyOf(req);
      // 60,000 characters fits the 256 KB body limit even when every character is Chinese.
      const text = str(body, "body", { max: 60_000 });
      const restoredFrom = num(body, "restoredFrom", { integer: true, min: 1 });
      const rule = saveWriterRule(config, store, name, text, restoredFrom);
      app.log.info("writing.rules_saved", {
        name,
        chars: rule.body.length,
        version: rule.versions[0]?.id,
        restoredFrom,
      });
      res.json(rule);
    },
  };
}
