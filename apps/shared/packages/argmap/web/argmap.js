// argmap JSON → Excalidraw 元素。先量文字，再按内容排位置；画布由排完的结果决定（导出时按内容裁切）。
(() => {
  const { convertToExcalidrawElements: convert } = window.EXC;

  const KIND = {
    // 类型 → [标签, 描边色, 浅底色]（Excalidraw 自带调色板）
    thesis: ["主张", "#1971c2", "#e7f5ff"],
    evidence: ["证据", "#2f9e44", "#ebfbee"],
    rebuttal: ["反驳", "#e03131", "#fff5f5"],
    result: ["实验", "#6741d9", "#f3f0ff"],
    support: ["支撑", "#495057", "#f8f9fa"],
    concession: ["让步", "#e8590c", "#fff4e6"],
    "our-take": ["我们的判断", "#e67700", "#fff9db"],
    decision: ["拍板", "#6741d9", "#f3f0ff"],
    question: ["疑问", "#c2255c", "#fff0f6"],
    // 下面几种给 steps / system / timeline / loop 用
    step: ["步骤", "#1971c2", "#e7f5ff"],
    check: ["验收", "#2f9e44", "#ebfbee"],
    pitfall: ["卡住时", "#c2255c", "#fff0f6"],
    component: ["组件", "#0c8599", "#e3fafc"],
    data: ["数据", "#5c940d", "#f4fce3"],
    actor: ["使用者", "#495057", "#f8f9fa"],
    event: ["事件", "#495057", "#f8f9fa"],
    turn: ["转折", "#e03131", "#fff5f5"],
    group: ["模块", "#868e96", "transparent"],
  };
  const EDGE = {
    supports: "#495057",
    refutes: "#e03131",
    qualifies: "#e8590c",
    enables: "#1971c2",
  };
  const INK = "#1e1e1e",
    FAINT = "#868e96";

  const strip = (s) => (s || "").replace(/\*\*(.+?)\*\*/g, "$1");

  // ---- 测量：让 Excalidraw 自己换行、量高 ----
  // 实测：含拉丁字母的行，Excalidraw 换行时量得比实际渲染窄 3–5%，会越出卡片右边，所以按 93% 宽度换行
  const FIT = 0.93;
  function textBox(text, width, size, font) {
    const [rect] = convert([
      {
        type: "rectangle",
        x: 0,
        y: 0,
        width: width * FIT + 10,
        height: 1,
        label: { text, fontSize: size, fontFamily: font, textAlign: "left", verticalAlign: "top" },
      },
    ]);
    return rect.height - 10; // 去掉 Excalidraw 绑定文字的上下各 5px
  }

  // 单行文字的宽度（分组框标题用）
  function textW(text, size, font) {
    const [t] = convert([{ type: "text", x: 0, y: 0, text, fontSize: size, fontFamily: font }]);
    return t.width / FIT;
  }

  function makeKit(opt) {
    const S = opt.style; // { title, body, tag, font, bodyFont, rough, pad }
    const out = [];
    const pos = {}; // id → {x, y, w, h}，连线用
    let gid = 0;
    // 一段可换行文字：透明容器 + 标签（编辑器里仍可改字、会自动换行）
    function para(id, text, x, y, w, size, font, color, group, align = "left") {
      const h = textBox(text, w, size, font);
      out.push({
        type: "rectangle",
        id,
        x: x - 5,
        y: y - 5,
        width: w * FIT + 10,
        height: h + 10,
        strokeColor: "transparent",
        backgroundColor: "transparent",
        roughness: 0,
        groupIds: group ? [group] : [],
        label: {
          text,
          fontSize: size,
          fontFamily: font,
          textAlign: align,
          verticalAlign: "top",
          strokeColor: color,
        },
      });
      return h;
    }
    // 卡片：返回 {h}，measure=true 时只量不画
    function card(n, x, y, w, { tag, strong, measure, minH = 0 } = {}) {
      const [label, stroke, fill] = KIND[n.kind] || KIND.support;
      const p = S.pad,
        iw = w - 2 * p;
      tag = tag || label;
      const th = textBox(strip(n.title), iw, S.title, S.font);
      const bh = n.point ? textBox(strip(n.point), iw, S.body, S.bodyFont) : 0;
      const h = Math.max(minH, p + S.tag * 1.3 + 6 + th + (bh ? 8 + bh : 0) + p);
      if (measure) return { h };
      pos[n.id] = { x, y, w, h };
      const g = `g${gid++}`;
      out.push({
        type: "rectangle",
        id: n.id,
        x,
        y,
        width: w,
        height: h,
        strokeColor: stroke,
        backgroundColor: fill,
        fillStyle: "solid",
        strokeWidth: strong ? 3 : 2,
        roughness: S.rough,
        roundness: { type: 3 },
        groupIds: [g],
      });
      out.push({
        type: "text",
        x: x + p,
        y: y + p,
        text: tag,
        fontSize: S.tag,
        fontFamily: S.bodyFont,
        strokeColor: stroke,
        groupIds: [g],
      });
      let cy = y + p + S.tag * 1.3 + 6;
      para(`${n.id}_t`, strip(n.title), x + p, cy, iw, S.title, S.font, INK, g);
      if (bh)
        para(`${n.id}_b`, strip(n.point), x + p, cy + th + 8, iw, S.body, S.bodyFont, "#343a40", g);
      return { h };
    }
    function arrow(
      id,
      from,
      to,
      pts,
      { color = EDGE.supports, dashed = false, label = "", head = "arrow", width = 2 } = {},
    ) {
      const [x0, y0] = pts[0];
      out.push({
        type: "arrow",
        id,
        x: x0,
        y: y0,
        points: pts.map(([x, y]) => [x - x0, y - y0]),
        strokeColor: color,
        strokeWidth: width,
        strokeStyle: dashed ? "dashed" : "solid",
        roughness: S.rough,
        endArrowhead: head,
        startArrowhead: null,
        roundness: null,
        start: from ? { id: from } : undefined,
        end: to ? { id: to } : undefined,
        label: label
          ? { text: label, fontSize: S.tag, fontFamily: S.bodyFont, strokeColor: color }
          : undefined,
      });
    }
    // 两张已画的卡之间自动走直角线：横向距离大就从左右边出，否则从上下边出
    function link(id, a, b, o = {}) {
      const A = pos[a],
        B = pos[b];
      if (!A || !B) return;
      const acx = A.x + A.w / 2,
        acy = A.y + A.h / 2,
        bcx = B.x + B.w / 2,
        bcy = B.y + B.h / 2;
      const gapX = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w)),
        gapY = Math.max(B.y - (A.y + A.h), A.y - (B.y + B.h));
      let pts;
      if (gapX >= gapY) {
        const sx = bcx > acx ? A.x + A.w : A.x,
          ex = bcx > acx ? B.x : B.x + B.w;
        const sy = Math.max(A.y + 20, Math.min(A.y + A.h - 20, bcy)),
          ey = Math.max(B.y + 20, Math.min(B.y + B.h - 20, acy));
        const my = (sy + ey) / 2;
        pts =
          Math.abs(sy - ey) < 2
            ? [
                [sx, sy],
                [ex, ey],
              ]
            : [
                [sx, sy],
                [(sx + ex) / 2, sy],
                [(sx + ex) / 2, ey],
                [ex, ey],
              ];
        void my;
      } else {
        const sy = bcy > acy ? A.y + A.h : A.y,
          ey = bcy > acy ? B.y : B.y + B.h;
        const sx = Math.max(A.x + 20, Math.min(A.x + A.w - 20, bcx)),
          ex = Math.max(B.x + 20, Math.min(B.x + B.w - 20, acx));
        pts =
          Math.abs(sx - ex) < 2
            ? [
                [sx, sy],
                [ex, ey],
              ]
            : [
                [sx, sy],
                [sx, (sy + ey) / 2],
                [ex, (sy + ey) / 2],
                [ex, ey],
              ];
      }
      arrow(id, a, b, pts, o);
    }
    // 分组框：虚线圆角框 + 左上角标题（system 版式的模块）
    function frame(n, x, y, w, h) {
      pos[n.id] = { x, y, w, h };
      out.push({
        type: "rectangle",
        id: n.id,
        x,
        y,
        width: w,
        height: h,
        strokeColor: "#868e96",
        backgroundColor: "transparent",
        strokeStyle: "dashed",
        strokeWidth: 2,
        roughness: S.rough,
        roundness: { type: 3 },
      });
      out.push({
        type: "text",
        x: x + 16,
        y: y + 12,
        text: strip(n.title),
        fontSize: S.title,
        fontFamily: S.font,
        strokeColor: INK,
      });
      if (n.point)
        para(
          `${n.id}_b`,
          strip(n.point),
          x + 16,
          y + 12 + S.title * 1.35,
          w - 32,
          S.tag + 1,
          S.bodyFont,
          FAINT,
          null,
        );
    }
    const frameHead = (n, w) =>
      12 +
      S.title * 1.35 +
      (n.point ? textBox(strip(n.point), w - 32, S.tag + 1, S.bodyFont) + 6 : 0) +
      14;
    return { out, pos, para, card, arrow, link, frame, frameHead, textBox };
  }

  // ---- 版式 ----
  const byCol = (ns) => ns.slice().sort((a, b) => a.col - b.col);

  // 纵向流程：主干自上而下，子节点贴在它右侧（一条推进链 / 一般 DAG 都能用）
  function flow(d, K, S, { numbered = false } = {}) {
    const nodes = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
    const bb = byCol(d.nodes.filter((n) => n.row === 0));
    const side = {};
    for (const e of d.edges)
      if (nodes[e.to].row > 0 && nodes[e.from]) (side[e.from] ||= []).push([nodes[e.to], e]);
    const BW = S.cardW + 120,
      SW = S.cardW,
      GX = 130,
      GY = 70;
    let y = 0;
    const pos = {};
    for (const n of bb) {
      const kids = side[n.id] || [];
      const mh = K.card(n, 0, 0, BW, { measure: true }).h;
      const kh =
        kids.reduce((s, [k]) => s + K.card(k, 0, 0, SW, { measure: true }).h, 0) +
        24 * Math.max(kids.length - 1, 0);
      pos[n.id] = { y, h: Math.max(mh, kh) };
      K.card(n, 0, y, BW, {
        strong: n.kind === "thesis" || n.kind === "our-take",
        tag: numbered ? `第 ${bb.indexOf(n) + 1} 步` : undefined,
      });
      let ky = y;
      for (const [k, e] of kids) {
        const h = K.card(k, BW + GX, ky, SW).h;
        // 从主卡右侧中点出发，经一根竖向导轨接到子卡；子卡低于主卡时不会悬空
        const py = y + Math.min(mh / 2, 60),
          qy = ky + Math.min(h / 2, 60),
          rx = BW + GX / 2;
        K.arrow(
          `e_${n.id}_${k.id}`,
          n.id,
          k.id,
          py === qy
            ? [
                [BW, py],
                [BW + GX, qy],
              ]
            : [
                [BW, py],
                [rx, py],
                [rx, qy],
                [BW + GX, qy],
              ],
          {
            color: (KIND[k.kind] || KIND.support)[1],
            dashed: true,
            label: e.label || "",
            head: "dot",
          },
        );
        ky += h + 24;
      }
      y += pos[n.id].h + GY;
    }
    const lab = Object.fromEntries(d.edges.map((e) => [`${e.from}>${e.to}`, e]));
    for (let i = 0; i + 1 < bb.length; i++) {
      const a = bb[i],
        b = bb[i + 1],
        e = lab[`${a.id}>${b.id}`] || {};
      const ah = K.card(a, 0, 0, BW, { measure: true }).h;
      K.arrow(
        `e_${a.id}_${b.id}`,
        a.id,
        b.id,
        [
          [BW / 2, pos[a.id].y + ah],
          [BW / 2, pos[b.id].y],
        ],
        { color: EDGE[e.kind] || EDGE.supports, label: e.label || "", width: 2.5 },
      );
    }
    return { w: BW + (Object.keys(side).length ? GX + SW : 0), h: y - GY };
  }

  // 鱼骨：鱼尾主张 → 中间几根骨头上下交替 → 鱼头结论；骨头数量由数据决定
  function fishbone(d, K, S) {
    const bb = byCol(d.nodes.filter((n) => n.row === 0));
    const tail = bb[0],
      head = bb[bb.length - 1],
      bones = bb.slice(1, -1);
    const child = Object.fromEntries(d.nodes.filter((n) => n.row === 1).map((n) => [n.col, n]));
    const lab = Object.fromEntries(d.edges.map((e) => [`${e.from}>${e.to}`, e]));
    const W = S.cardW,
      G = 40,
      SPG = 70; // 卡宽、卡间距、骨头卡到脊柱的距离
    const boneH = bones.map(
      (n) =>
        K.card(n, 0, 0, W, { measure: true }).h +
        (child[n.col] ? 16 + K.card(child[n.col], 0, 0, W - 32, { measure: true }).h + 16 : 0),
    );
    const topH = Math.max(0, ...boneH.filter((_, i) => i % 2 === 0));
    const botH = Math.max(0, ...boneH.filter((_, i) => i % 2 === 1));
    const spineY = topH + SPG;
    const tailW = W,
      headW = W + 40;
    const th = K.card(tail, 0, 0, tailW, { measure: true }).h,
      hh = K.card(head, 0, 0, headW, { measure: true }).h;
    // 骨头卡交错排：每根相对上一根右移半张卡多一点，同侧不重叠
    const step = (W + G) / 2 + 20;
    const bx = bones.map((_, i) => tailW + 110 + i * step);
    const headX = (bones.length ? bx[bones.length - 1] + W : tailW) + 110;
    K.card(tail, 0, spineY - th / 2, tailW, { strong: true });
    K.card(head, headX, spineY - hh / 2, headW, { strong: true });
    const subs = [
      [tail, 0, spineY + th / 2, tailW],
      [head, headX, spineY + hh / 2, headW],
    ];
    for (const [a, x, y, w] of subs) {
      const s = child[a.col];
      if (!s) continue;
      K.card(s, x, y + 50, w);
      K.arrow(
        `e_${a.id}_${s.id}`,
        a.id,
        s.id,
        [
          [x + w / 2, y],
          [x + w / 2, y + 50],
        ],
        { color: KIND[s.kind][1], dashed: true, head: "dot" },
      );
    }
    K.arrow(
      "spine",
      tail.id,
      head.id,
      [
        [tailW, spineY],
        [headX, spineY],
      ],
      { color: INK, width: 4 },
    );
    bones.forEach((n, i) => {
      const top = i % 2 === 0,
        x = bx[i],
        h = boneH[i];
      const y = top ? spineY - SPG - h : spineY + SPG;
      // 骨头卡 = 主干卡 + 内嵌的子卡
      const s = child[n.col];
      const mh = K.card(n, 0, 0, W, { measure: true }).h;
      K.card(n, x, y, W, { minH: h });
      if (s) {
        const sh = K.card(s, x + 16, y + mh, W - 32).h;
        void sh;
      }
      const sx = x + W * 0.55,
        sy = top ? y + h : y,
        jx = sx + 60;
      const e = lab[`${n.id}>${head.id}`] || lab[`${tail.id}>${n.id}`] || {};
      K.arrow(
        `bone_${n.id}`,
        n.id,
        null,
        [
          [sx, sy],
          [jx, spineY],
        ],
        { color: KIND[n.kind][1], width: 3, head: "dot", label: e.label || "" },
      );
    });
    // 骨头之间的边（同侧才画，走卡片上沿）
    const ids = bones.map((n) => n.id);
    for (const e of d.edges) {
      const fi = ids.indexOf(e.from),
        ti = ids.indexOf(e.to);
      if (fi < 0 || ti < 0 || fi % 2 !== ti % 2) continue;
      const top = fi % 2 === 0;
      const ya = top ? spineY - SPG - boneH[fi] : spineY + SPG + boneH[fi];
      const yb = top ? spineY - SPG - boneH[ti] : spineY + SPG + boneH[ti];
      const yl = top ? Math.min(ya, yb) - 40 : Math.max(ya, yb) + 40;
      K.arrow(
        `x_${e.from}_${e.to}`,
        e.from,
        e.to,
        [
          [bx[fi] + W / 2, ya],
          [bx[fi] + W / 2, yl],
          [bx[ti] + W / 2, yl],
          [bx[ti] + W / 2, yb],
        ],
        { color: EDGE[e.kind] || FAINT, dashed: true, label: e.label || "" },
      );
    }
    const minY = Math.min(spineY - th / 2, spineY - hh / 2, topH ? 0 : spineY),
      maxY = spineY + SPG + botH;
    return { w: headX + headW, h: maxY - minY };
  }

  // 正文 + 批注：左栏原文要点，右栏批注；每条批注和它批注的那一条原文对齐成一个横带
  function annotated(d, K, S) {
    const body = byCol(d.nodes.filter((n) => n.row === 0));
    const notes = d.nodes.filter((n) => n.row > 0);
    const target = {};
    for (const e of d.edges) if (notes.some((n) => n.id === e.to)) target[e.to] = e;
    const LW = S.cardW + 120,
      RW = S.cardW + 40,
      GX = 110,
      GY = 28,
      BAND = 56;
    let y = 0;
    for (const b of body) {
      const mine = notes.filter((n) => target[n.id] && target[n.id].from === b.id);
      const bh = K.card(b, 0, 0, LW, { measure: true }).h;
      const nh = mine.map((n) => K.card(n, 0, 0, RW, { measure: true }).h);
      const band = Math.max(bh, nh.reduce((s, h) => s + h, 0) + GY * Math.max(mine.length - 1, 0));
      K.card(b, 0, y, LW, { strong: b === body[0] });
      let ny = y;
      mine.forEach((n, i) => {
        const lbl = { support: "补充", concession: "异议" }[n.kind] || KIND[n.kind][0];
        K.card(n, LW + GX, ny, RW, { tag: n.author ? `${n.author} · ${lbl}` : lbl });
        const ay = Math.min(y + bh / 2, ny + nh[i] / 2);
        K.arrow(
          `e_${b.id}_${n.id}`,
          b.id,
          n.id,
          [
            [LW, Math.min(y + bh - 20, ny + 30)],
            [LW + GX, ny + 30],
          ],
          { color: KIND[n.kind][1], dashed: true, head: "dot", label: target[n.id].label || "" },
        );
        void ay;
        ny += nh[i] + GY;
      });
      y += band + BAND;
    }
    return { w: LW + GX + RW, h: y - BAND };
  }

  // 目标树：顶部目标，下面一排并列柱子，柱子下挂子节点
  function tree(d, K, S) {
    const bb = byCol(d.nodes.filter((n) => n.row === 0));
    const goal = bb[0],
      pillars = bb.slice(1);
    const child = Object.fromEntries(
      d.nodes.filter((n) => n.row === 1 && n.col !== goal.col).map((n) => [n.col, n]),
    );
    const PW = S.cardW,
      G = 36;
    const W = pillars.length * PW + (pillars.length - 1) * G;
    const gh = K.card(goal, 0, 0, W, { measure: true }).h;
    K.card(goal, 0, 0, W, { strong: true });
    const py = gh + 80;
    const ph = Math.max(...pillars.map((p) => K.card(p, 0, 0, PW, { measure: true }).h));
    const lab = Object.fromEntries(d.edges.map((e) => [`${e.from}>${e.to}`, e]));
    let bottom = py + ph;
    pillars.forEach((p, i) => {
      const x = i * (PW + G);
      K.card(p, x, py, PW, { minH: ph });
      const e = lab[`${goal.id}>${p.id}`] || {};
      K.arrow(
        `e_${goal.id}_${p.id}`,
        goal.id,
        p.id,
        [
          [x + PW / 2, gh],
          [x + PW / 2, py],
        ],
        { color: EDGE[e.kind] || EDGE.supports, label: e.label || "" },
      );
      const s = child[p.col];
      if (s) {
        const sh = K.card(s, x + 20, py + ph + 50, PW - 20).h;
        K.arrow(
          `e_${p.id}_${s.id}`,
          p.id,
          s.id,
          [
            [x + PW / 2, py + ph],
            [x + PW / 2, py + ph + 50],
          ],
          { color: KIND[s.kind][1], dashed: true, head: "dot" },
        );
        bottom = Math.max(bottom, py + ph + 50 + sh);
      }
    });
    return { w: W, h: bottom };
  }

  // 操作步骤：编号步骤自上而下，命令 / 验收点 / 卡住时 挂在右侧
  const steps = (d, K, S) => flow(d, K, S, { numbered: true });

  // 时间线：横轴，事件卡上下交替挂在刻度上；子节点叠在同侧更外面
  function timeline(d, K, S) {
    const ev = byCol(d.nodes.filter((n) => n.row === 0));
    const kids = {};
    for (const e of d.edges) {
      const k = d.nodes.find((n) => n.id === e.to);
      if (k && k.row > 0) (kids[e.from] ||= []).push(k);
    }
    const W = S.cardW - 40,
      STEP = W / 2 + 40,
      ARM = 56,
      KG = 20;
    const stackH = (n) =>
      K.card(n, 0, 0, W, { measure: true }).h +
      (kids[n.id] || []).reduce((s, k) => s + KG + K.card(k, 0, 0, W - 30, { measure: true }).h, 0);
    const hs = ev.map(stackH);
    const up = Math.max(0, ...hs.filter((_, i) => i % 2 === 0)),
      down = Math.max(0, ...hs.filter((_, i) => i % 2 === 1));
    const ay = up + ARM;
    const x0 = 0,
      x1 = (ev.length - 1) * STEP + W;
    K.arrow(
      "axis",
      null,
      null,
      [
        [x0 - 20, ay],
        [x1 + 40, ay],
      ],
      { color: INK, width: 3 },
    );
    ev.forEach((n, i) => {
      const top = i % 2 === 0,
        x = i * STEP,
        h = K.card(n, 0, 0, W, { measure: true }).h;
      const y = top ? ay - ARM - h : ay + ARM;
      K.card(n, x, y, W, {
        tag: n.date || undefined,
        strong: n.kind === "turn" || n.kind === "our-take",
      });
      K.arrow(
        `tick_${n.id}`,
        n.id,
        null,
        [
          [x + W / 2, top ? y + h : y],
          [x + W / 2, ay],
        ],
        { color: (KIND[n.kind] || KIND.event)[1], head: "dot" },
      );
      let ky = top ? y : y + h;
      for (const k of kids[n.id] || []) {
        const kh = K.card(k, 0, 0, W - 30, { measure: true }).h;
        ky = top ? ky - KG - kh : ky + KG;
        K.card(k, x + 15, ky, W - 30);
        if (!top) ky += kh;
      }
    });
    return { w: x1 + 60, h: up + down + 2 * ARM };
  }

  // 循环：几步排成一圈首尾相接，中心写循环的目的（center: true），退出条件（row 1）从环上引出
  function loop(d, K, S) {
    const center = d.nodes.find((n) => n.center);
    const ring = byCol(d.nodes.filter((n) => n.row === 0 && !n.center));
    const kids = d.nodes.filter((n) => n.row > 0);
    const W = S.cardW - 60,
      N = ring.length;
    const hs = ring.map((n) => K.card(n, 0, 0, W, { measure: true }).h);
    const H = Math.max(...hs);
    const R = Math.max(W * 0.95, (W + 60) / (2 * Math.sin(Math.PI / N))); // 相邻两卡中心距 ≥ 卡宽 + 60
    const rx = R * 1.15,
      ry = Math.max(R * 0.8, H + 60);
    const ctr = {};
    ring.forEach((n, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / N;
      const cx = rx * Math.cos(a),
        cy = ry * Math.sin(a);
      ctr[n.id] = [cx, cy];
      K.card(n, cx - W / 2, cy - hs[i] / 2, W, {
        tag: `${i + 1} · ${(KIND[n.kind] || KIND.step)[0]}`,
      });
    });
    if (center) {
      const cw = Math.min(W + 40, rx * 1.1),
        ch = K.card(center, 0, 0, cw, { measure: true }).h;
      K.card(center, -cw / 2, -ch / 2, cw, { strong: true });
    }
    // 环上的箭头：从一张卡的边朝下一张卡的中心，取直线
    const clip = (P, c, t) => {
      const [cx, cy] = c,
        dx = t[0] - cx,
        dy = t[1] - cy;
      const k = Math.min(
        Math.abs((P.w / 2 + 6) / (dx || 1e-9)),
        Math.abs((P.h / 2 + 6) / (dy || 1e-9)),
      );
      return [cx + dx * k, cy + dy * k];
    };
    const lab = Object.fromEntries(d.edges.map((e) => [`${e.from}>${e.to}`, e]));
    ring.forEach((n, i) => {
      const m = ring[(i + 1) % N],
        A = K.pos[n.id],
        B = K.pos[m.id];
      const e = lab[`${n.id}>${m.id}`] || {};
      K.arrow(
        `r_${n.id}_${m.id}`,
        n.id,
        m.id,
        [clip(A, ctr[n.id], ctr[m.id]), clip(B, ctr[m.id], ctr[n.id])],
        { color: EDGE[e.kind] || EDGE.enables, width: 2.5, label: e.label || "" },
      );
    });
    // 退出条件：放在它所挂的那张卡外侧
    for (const k of kids) {
      const e = d.edges.find((e) => e.to === k.id);
      if (!e || !ctr[e.from]) continue;
      const [cx, cy] = ctr[e.from],
        P = K.pos[e.from],
        kh = K.card(k, 0, 0, W, { measure: true }).h;
      const right = cx >= 0,
        kx = right ? P.x + P.w + 90 : P.x - 90 - W;
      K.card(k, kx, cy - kh / 2, W);
      K.link(`x_${e.from}_${k.id}`, e.from, k.id, {
        color: (KIND[k.kind] || KIND.support)[1],
        dashed: true,
        label: e.label || "",
      });
    }
    return { w: 2 * rx + W, h: 2 * ry + H };
  }

  // 对辩：左右两方逐回合对齐成行；顶部议题（无 side 的 row 0），底部我们的判断（无 side 的 row ≥ 1）
  function debate(d, K, S) {
    const sides = d.sides || { A: "正方", B: "反方" };
    const topic = d.nodes.find((n) => !n.side && n.row === 0),
      verdict = d.nodes.filter((n) => !n.side && n.row > 0);
    const rounds = [...new Set(d.nodes.filter((n) => n.side).map((n) => n.col))].sort(
      (a, b) => a - b,
    );
    const W = S.cardW + 40,
      GX = 140,
      FW = 2 * W + GX;
    let y = 0;
    if (topic) {
      y += K.card(topic, 0, 0, FW, { strong: true }).h + 40;
    }
    for (const [k, x] of [
      ["A", 0],
      ["B", W + GX],
    ]) {
      K.out.push({
        type: "text",
        x,
        y,
        text: sides[k],
        fontSize: S.title,
        fontFamily: S.font,
        strokeColor: k === "A" ? "#1971c2" : "#e03131",
      });
    }
    y += S.title * 1.6 + 10;
    for (const r of rounds) {
      const a = d.nodes.find((n) => n.side === "A" && n.col === r),
        b = d.nodes.find((n) => n.side === "B" && n.col === r);
      const h = Math.max(
        a ? K.card(a, 0, 0, W, { measure: true }).h : 0,
        b ? K.card(b, 0, 0, W, { measure: true }).h : 0,
      );
      if (a)
        K.card(a, 0, y, W, { minH: h, tag: `第 ${r} 回合 · ${(KIND[a.kind] || KIND.thesis)[0]}` });
      if (b)
        K.card(b, W + GX, y, W, {
          minH: h,
          tag: `第 ${r} 回合 · ${(KIND[b.kind] || KIND.rebuttal)[0]}`,
        });
      y += h + 46;
    }
    for (const e of d.edges) {
      const f = d.nodes.find((n) => n.id === e.from),
        t = d.nodes.find((n) => n.id === e.to);
      if (f && t && f.side && t.side)
        K.link(`e_${e.from}_${e.to}`, e.from, e.to, {
          color: EDGE[e.kind] || EDGE.refutes,
          label: e.label || "",
        });
    }
    for (const v of verdict) {
      y += 4;
      y += K.card(v, 0, y, FW, { strong: true }).h + 24;
    }
    return { w: FW, h: y };
  }

  // 对比：表格。顶行是对象（d.sides），左列是维度（d.dims），格子是 {side, dim} 节点；无 side 的节点是底部结论
  function compare(d, K, S) {
    const sides = d.sides || [...new Set(d.nodes.filter((n) => n.side).map((n) => n.side))];
    const dims = d.dims || [...new Set(d.nodes.filter((n) => n.dim).map((n) => n.dim))];
    const concl = d.nodes.filter((n) => !n.side);
    const LW = 170,
      W = S.cardW - 20,
      G = 20;
    const FW = LW + sides.length * (W + G) - G;
    let y = 0;
    sides.forEach((sd, i) => {
      const x = LW + i * (W + G);
      K.out.push({
        type: "text",
        x: x + 4,
        y,
        text: sd,
        fontSize: S.title + 3,
        fontFamily: S.font,
        strokeColor: INK,
      });
    });
    y += (S.title + 3) * 1.5 + 10;
    for (const dm of dims) {
      const cells = sides.map((sd) => d.nodes.find((n) => n.side === sd && n.dim === dm));
      const h = Math.max(...cells.map((c) => (c ? K.card(c, 0, 0, W, { measure: true }).h : 60)));
      K.para(
        `dim_${dims.indexOf(dm)}`,
        dm,
        0,
        y + 14,
        LW - 24,
        S.title - 2,
        S.font,
        "#495057",
        null,
      );
      K.arrow(
        `rule_${dims.indexOf(dm)}`,
        null,
        null,
        [
          [0, y - G / 2],
          [FW, y - G / 2],
        ],
        { color: "#dee2e6", width: 1, head: null },
      );
      cells.forEach((c, i) => {
        if (c) K.card(c, LW + i * (W + G), y, W, { minH: h, tag: c.verdict || undefined });
      });
      y += h + G;
    }
    for (const c of concl) {
      y += 16;
      y += K.card(c, 0, y, FW, { strong: true }).h;
    }
    return { w: FW, h: y };
  }

  // 架构拆解：kind=group 的节点是分组框，其余节点用 group 字段指明属于哪个框（可嵌套）；
  // 同一层里按 row / col 排成网格，行高、列宽取该行 / 列最大的那个；最后按 edges 画数据流
  function system(d, K, S) {
    const W = S.cardW - 60,
      G = 44,
      P = 22;
    const kids = (id) => d.nodes.filter((n) => (n.group || null) === id);
    const memo = {};
    function size(n) {
      if (memo[n.id]) return memo[n.id];
      if (n.kind !== "group")
        return (memo[n.id] = { w: W, h: K.card(n, 0, 0, W, { measure: true }).h });
      const g = grid(kids(n.id));
      const w = Math.max(g.w + 2 * P, 260, textW(strip(n.title), S.title, S.font) + 40);
      return (memo[n.id] = { w, h: K.frameHead(n, w) + g.h + P, g });
    }
    function grid(ns) {
      const rows = [...new Set(ns.map((n) => n.row || 0))].sort((a, b) => a - b),
        cols = [...new Set(ns.map((n) => n.col || 0))].sort((a, b) => a - b);
      const cw = cols.map((c) =>
        Math.max(...ns.filter((n) => (n.col || 0) === c).map((n) => size(n).w)),
      );
      const rh = rows.map((r) =>
        Math.max(...ns.filter((n) => (n.row || 0) === r).map((n) => size(n).h)),
      );
      return {
        ns,
        rows,
        cols,
        cw,
        rh,
        w: cw.reduce((s, v) => s + v, 0) + G * (cols.length - 1),
        h: rh.reduce((s, v) => s + v, 0) + G * (rows.length - 1),
      };
    }
    function placeGrid(g, x0, y0) {
      for (const n of g.ns) {
        const ci = g.cols.indexOf(n.col || 0),
          ri = g.rows.indexOf(n.row || 0);
        const x = x0 + g.cw.slice(0, ci).reduce((s, v) => s + v + G, 0),
          y = y0 + g.rh.slice(0, ri).reduce((s, v) => s + v + G, 0);
        place(n, x + (g.cw[ci] - size(n).w) / 2, y);
      }
    }
    function place(n, x, y) {
      const sz = size(n);
      if (n.kind !== "group") return K.card(n, x, y, W);
      K.frame(n, x, y, sz.w, sz.h);
      placeGrid(sz.g, x + (sz.w - sz.g.w) / 2, y + K.frameHead(n, sz.w));
    }
    const top = grid(kids(null));
    placeGrid(top, 0, 0);
    for (const e of d.edges)
      K.link(`e_${e.from}_${e.to}`, e.from, e.to, {
        color: EDGE[e.kind] || EDGE.supports,
        label: e.label || "",
        dashed: e.kind === "qualifies",
      });
    return { w: top.w, h: top.h };
  }

  const LAYOUTS = {
    flow,
    fishbone,
    annotated,
    tree,
    steps,
    timeline,
    loop,
    debate,
    compare,
    system,
  };

  // ---- 整张图：版式 → 量出内容框 → 页眉、图例、图脚贴在它上下 ----
  window.ARGMAP = function render(d, opt) {
    const K = makeKit(opt);
    const S = opt.style;
    const layout = opt.layout || d.layout || "flow";
    const box = LAYOUTS[layout](d, K, S);
    const body = K.out.splice(0);
    // 内容实际包围盒
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const e of body) {
      if (e.type === "arrow") continue;
      minX = Math.min(minX, e.x);
      minY = Math.min(minY, e.y);
      maxX = Math.max(maxX, e.x + (e.width || 0));
      maxY = Math.max(maxY, e.y + (e.height || 0));
    }
    const W = Math.max(maxX - minX, 700);
    const lh = K.para("landmark", d.landmark, minX, 0, W, S.landmark, S.font, INK, null);
    let hy = lh + 10;
    if (d.reader)
      hy +=
        K.para("reader", "读者：" + d.reader, minX, hy, W, S.tag + 1, S.bodyFont, FAINT, null) + 6;
    const shift = hy + 34 - minY;
    for (const e of body) {
      e.y += shift;
    }
    K.out.push(...body);
    let fy = maxY + shift + 40;
    // 图例：只列实际用到的类型
    const kinds = [...new Set(d.nodes.map((n) => n.kind))].filter((k) => k !== "group");
    let lx = minX;
    for (const k of kinds) {
      const [label, stroke, fill] = KIND[k] || KIND.support;
      K.out.push({
        type: "rectangle",
        x: lx,
        y: fy + 3,
        width: 16,
        height: 16,
        strokeColor: stroke,
        backgroundColor: fill,
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: S.rough,
        roundness: { type: 3 },
      });
      K.out.push({
        type: "text",
        x: lx + 24,
        y: fy,
        text: label,
        fontSize: S.tag,
        fontFamily: S.bodyFont,
        strokeColor: "#495057",
      });
      lx += 24 + label.length * S.tag + 34;
    }
    fy += 34;
    const art = d.article || {};
    const foot = [
      d.footnote,
      art.title ? `出处：${art.title}${art.published ? `（${art.published}）` : ""}` : "",
    ]
      .filter(Boolean)
      .join("　");
    if (foot) K.para("footnote", foot, minX, fy, W, S.tag, S.bodyFont, FAINT, null);
    return { elements: convert(K.out, { regenerateIds: false }), size: box };
  };
})();
