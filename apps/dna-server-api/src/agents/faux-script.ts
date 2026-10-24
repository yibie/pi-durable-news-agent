// DNA_PROVIDER=faux: a scripted stand-in for both agents that walks a whole sweep with real tools, including one
// bad component call so the enum feedback path runs. Free and deterministic, for tests and offline demos.
import { call, calls, say, type FauxRule, type FauxTurn } from "@dna/durable-agent";

const ids = (text: string) => [...new Set([...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1])))];
const called = (turn: FauxTurn, name: string) => turn.calls.filter((c) => c.name === name);
const resultOf = (turn: FauxTurn, name: string) => turn.results.filter((r) => r.name === name);
const leadIds = (prompt: string) =>
  [...(prompt.match(/SOURCE_LEADS: (.*)/)?.[1] ?? "").matchAll(/lead (\d+)/g)].map((m) =>
    Number(m[1]),
  );

/** Save every lead the sweep prompt offers, once, before complete_sweep. */
function saveLeads(turn: FauxTurn) {
  const leads = leadIds(turn.lastUser);
  if (!leads.length || called(turn, "save_source").length) return undefined;
  return calls(
    leads.map((id) => ({
      name: "save_source",
      args: { lead_id: id, reason: "The reader upvoted a post from this site." },
    })),
  );
}

function titles(sweepResult: string): Map<number, { title: string; discussion: boolean }> {
  const out = new Map<number, { title: string; discussion: boolean }>();
  for (const line of sweepResult.split("\n")) {
    const m = line.match(/^#(\d+) (.+?) \(/);
    if (m) out.set(Number(m[1]), { title: m[2], discussion: line.includes("has discussion") });
  }
  return out;
}

function component(hfsLine: string | undefined, discussion: boolean, title: string) {
  const score = (k: string) => Number(hfsLine?.match(new RegExp(`${k} (\\d+)`))?.[1] ?? 0);
  const primary = hfsLine?.match(/primary (\w+)/)?.[1];
  if (primary === "hype" && score("hype") >= 40)
    return {
      component: "hype_watch",
      props: { title, reality_check: "No benchmarks, no release date, and no primary source." },
    };
  if (discussion)
    return {
      component: "thread_pulse",
      props: {
        title,
        takes: [
          "Engineers want durable runs by default",
          "Some ask for better observability first",
        ],
      },
    };
  if (primary === "signal" && score("signal") >= 60)
    return {
      component: "signal_alert",
      props: {
        title,
        action: "Read the migration notes and plan the upgrade this week.",
        why: "It changes how agents run in production.",
      },
    };
  return {
    component: "brief",
    props: { title, summary: "Verified against the release notes and worth a look." },
  };
}

const desk: FauxRule = (turn) => {
  if (!("news-desk" in turn.sections)) return undefined;
  const sweepId = Number(turn.lastUser.match(/SWEEP_ID: (\d+)/)?.[1] ?? 0);
  if (!sweepId) {
    if (/reader answered your taste question/i.test(turn.lastUser))
      return say("Noted. I will weigh items like that one accordingly from now on.");
    const deep = turn.lastUser.match(/Deep research #(\d+): researcher (\d+) of (\d+) reported/);
    if (deep)
      return say(
        `Deep research ${deep[1]}, researcher ${deep[2]} of ${deep[3]}: ${turn.lastUser.match(/\*\*Answer\*\*: (.*)/)?.[1] ?? "no answer"}`,
      );
    return say(`Got it. ${turn.lastUser.split("\n")[0].slice(0, 120)}`);
  }
  if (!called(turn, "run_news_sweep").length) return call("run_news_sweep", { sweep_id: sweepId });
  const sweepText = resultOf(turn, "run_news_sweep")[0]?.text ?? "";
  const candidates = ids(sweepText.split("\n").slice(1).join("\n")).slice(0, 4);
  if (!candidates.length) {
    const save = saveLeads(turn);
    if (save) return save;
    if (!called(turn, "complete_sweep").length)
      return call("complete_sweep", {
        sweep_id: sweepId,
        status: "no_news",
        summary: "Nothing worth attention this sweep.",
      });
    return say("No news worth your attention this sweep.");
  }
  const info = titles(sweepText);
  if (!called(turn, "research_items").length) {
    const batches = [];
    for (let i = 0; i < candidates.length; i += 2)
      batches.push({ item_ids: candidates.slice(i, i + 2) });
    return call("research_items", { sweep_id: sweepId, batches });
  }
  if (!called(turn, "jev_classify").length)
    return calls(
      candidates.map((id) => ({ name: "jev_classify", args: { command: "hfs", item_id: id } })),
    );
  const hfs = new Map(
    resultOf(turn, "jev_classify").map((r) => [Number(r.text.match(/^#(\d+)/)?.[1]), r.text]),
  );
  const presented = called(turn, "present_news");
  if (!presented.length)
    return call("present_news", {
      item_id: candidates[0],
      component: "poster",
      props: { title: info.get(candidates[0])?.title ?? "Untitled" },
    });
  if (presented.length === 1) {
    return calls(
      candidates.map((id) => {
        const { title, discussion } = info.get(id) ?? { title: `Item ${id}`, discussion: false };
        return {
          name: "present_news",
          args: { item_id: id, ...component(hfs.get(id), discussion, title.slice(0, 80)) },
        };
      }),
    );
  }
  const suspect = [...hfs.entries()].find(([, text]) => text.includes("suspect_combo"));
  if (suspect && !called(turn, "ask_taste").length)
    return call("ask_taste", {
      item_id: suspect[0],
      question: "Is this hype, facts or signal for you?",
    });
  const save = saveLeads(turn);
  if (save) return save;
  if (!called(turn, "complete_sweep").length)
    return call("complete_sweep", {
      sweep_id: sweepId,
      status: "presented",
      summary: `${candidates.length} items worth attention.`,
    });
  return say(`Presented ${candidates.length} items.`);
};

const researcher: FauxRule = (turn) => {
  if (!("news-researcher" in turn.sections)) return undefined;
  const items = ids(turn.lastUser.split("## Workflow")[0]);
  if (!called(turn, "read_item").length)
    return calls(
      items.map((id) => ({ name: "read_item", args: { item_id: id, max_chars: 1200 } })),
    );
  if (!called(turn, "report_findings").length) {
    return calls(
      items.map((id) => ({
        name: "report_findings",
        args: {
          item_id: id,
          summary: `Item ${id} is a concrete change an agentic engineer can act on.`,
          claims: ["The release is available now"],
          evidence_urls: [],
          actionability: "medium",
        },
      })),
    );
  }
  return say(items.map((id) => `#${id} reported`).join("\n"));
};

// A deep-research subagent: one search, open the first hit, follow the first link on it, then answer with the trail.
const deepResearcher: FauxRule = (turn) => {
  if (!("deep-research" in turn.sections)) return undefined;
  const question = turn.lastUser.match(/QUESTION: (.*)/)?.[1] ?? "the question";
  const which = turn.lastUser.match(/deep researcher (\d+) of (\d+)/);
  if (!called(turn, "deep_search").length)
    return call("deep_search", { query: question.slice(0, 120) });
  const opened = called(turn, "open_page").map((c) => String(c.arguments.url));
  const next =
    opened.length === 0
      ? resultOf(turn, "deep_search")[0]?.text.match(/https?:\/\/\S+/)?.[0]
      : opened.length === 1
        ? resultOf(turn, "open_page")[0]?.text.match(/: (https?:\/\/\S+)\s*$/m)?.[1]
        : undefined;
  if (next && !opened.includes(next)) return call("open_page", { url: next });
  return say(
    [
      `**Answer**: researcher ${which?.[1]} of ${which?.[2]} answered "${question.slice(0, 80)}".`,
      `**Findings**: the fixture page says the release is available now (${opened[0] ?? "no page"}).`,
      `**Trail**: ${opened.join(" then ") || "none"}`,
      "**Unknown**: nothing in a fixture.",
    ].join("\n"),
  );
};

// A pick's writer: read the pick and its first source, draw a two-card flow, save the draft, then answer. A reader's
// message after that (a revision request) saves one more revision with the same image.
const writer: FauxRule = (turn) => {
  if (!("writer" in turn.sections)) return undefined;
  if (!called(turn, "read_pick").length) return call("read_pick", {});
  const pick = resultOf(turn, "read_pick")[0]?.text ?? "";
  const url = pick.match(/\| (https?:\/\/\S+)/)?.[1] ?? "https://example.com/source";
  const item = Number(pick.match(/^item (\d+)/m)?.[1]);
  if (item && !called(turn, "read_source").length) return call("read_source", { item_id: item });
  if (!called(turn, "render_argmap").length && !/newest draft: revision/.test(pick))
    return call("render_argmap", {
      argmap: {
        layout: "flow",
        landmark: "一次发布改了什么：它让 agent 的运行可以中断后接着跑",
        reader: "在生产环境跑 agent 的工程师",
        nodes: [
          {
            id: "K1",
            kind: "thesis",
            title: "运行可以中断后接着跑",
            point: "进程崩了也不丢进度。",
            quote: "Runs resume after a crash.",
            source: url,
            col: 1,
            row: 0,
          },
          {
            id: "K2",
            kind: "our-take",
            title: "先在小任务上试",
            point: "长任务最受益。",
            col: 2,
            row: 0,
          },
        ],
        edges: [{ from: "K1", to: "K2", kind: "supports" }],
      },
    });
  const imageId = Number(
    (resultOf(turn, "render_argmap")[0]?.text ?? pick)
      .match(/image_id (\d+)|image (\d+)/)
      ?.slice(1)
      .find(Boolean),
  );
  const revisions = called(turn, "save_draft").length;
  if (!revisions)
    return call("save_draft", {
      body: "这次发布让 agent 的运行可以在进程崩溃后接着跑。\n\n我的判断：长任务最先受益。\n\n原文链接在评论区。\n#Agent #工程",
      reply: `原文：${url}`,
      image_id: imageId || undefined,
      note: /newest draft/.test(pick) ? "按读者意见改" : "初稿",
    });
  return say(`写好了：推进链版式，一张图加正文（第 ${revisions} 次保存）。`);
};

// "FAUX_CALL <tool> <json args>" calls one tool and echoes its result: drives single tools in tests and demos.
const direct: FauxRule = (turn) => {
  const m = turn.lastUser.match(/^FAUX_CALL (\w+) (\{.*\})$/s);
  if (!m) return undefined;
  if (!turn.calls.length) return call(m[1], JSON.parse(m[2]));
  const r = turn.results[0];
  return say(`${r?.isError ? "error" : "ok"}: ${r?.text ?? ""}`);
};

// The quick model's publish date job: the first date the page text states, as the JSON the prompt asks for.
const publishDate: FauxRule = (turn) => {
  if (!turn.system.includes("say when it was published")) return undefined;
  const text = turn.lastUser.split("Page text:")[1] ?? "";
  const m = text.match(
    /\b20\d{2}-\d{2}-\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, 20\d{2}\b/,
  );
  const d = m ? new Date(m[0].includes("-") ? `${m[0]}T00:00:00` : m[0]) : undefined;
  const day = d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : null;
  return say(JSON.stringify({ published: day }));
};

export const fauxRules = (): FauxRule[] => [
  publishDate,
  direct,
  researcher,
  deepResearcher,
  writer,
  desk,
];
