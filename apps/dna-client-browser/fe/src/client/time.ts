// Times in the content studio are Beijing time. A card says how fresh its item is: how long ago it was published
// (fresh within 24 hours, still in the 48 hour pool, or older) and the publish time itself.
const BEIJING = "Asia/Shanghai";

/** HH:MM in Beijing time. */
export const beijingTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BEIJING,
  });

function parts(d: Date, zone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { year: +p.year, month: +p.month, day: +p.day, time: `${p.hour}:${p.minute}` };
}

/** 今天 14:30, 明天 09:05, or 10月28日 14:30 (Beijing time): when a post in line goes. */
export function beijingDateTime(iso: string, now = Date.now()): string {
  const d = parts(new Date(iso), BEIJING);
  const today = parts(new Date(now), BEIJING);
  const tomorrow = parts(new Date(now + 86_400_000), BEIJING);
  const same = (a: typeof d, b: typeof d) =>
    a.year === b.year && a.month === b.month && a.day === b.day;
  const day = same(d, today) ? "今天" : same(d, tomorrow) ? "明天" : `${d.month}月${d.day}日`;
  return `${day} ${d.time}`;
}

/** The Beijing date (YYYY-MM-DD) a number of days from now, for choosing a day. */
export function beijingDay(offsetDays = 0, now = Date.now()): string {
  const p = parts(new Date(now + offsetDays * 86_400_000), BEIJING);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** 10月20日 10:24 in Beijing time, with the year when it is not this year; a date-only page gives just the day. */
export function beijingDate(iso: string, dateOnly = false): string {
  const d = new Date(iso);
  const p = parts(d, dateOnly ? "UTC" : BEIJING);
  const year = p.year !== parts(new Date(), BEIJING).year ? `${p.year}年` : "";
  return `${year}${p.month}月${p.day}日${dateOnly ? "" : ` ${p.time}`}`;
}

/** 刚刚, 25 分钟前, 30 小时前 (hours up to two days, so the 48 hour pool reads at a glance), 5 天前. */
export function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export type Freshness = "fresh" | "pool" | "old" | "unknown";

export interface When {
  freshness: Freshness;
  /** The headline: how long ago it was published, or 发布时间不详. */
  age: string;
  /** The publish time, or when the workbench found it. */
  at: string;
  title: string;
}

/** How fresh a card is, from its publish time; without one, from when the workbench found it. */
export function cardWhen(publishedAt: string | undefined, foundAt: string, now: number): When {
  if (!publishedAt) {
    return {
      freshness: "unknown",
      age: "发布时间不详",
      at: `${ago(foundAt, now)}收录`,
      title: `原文没有标发布时间。工作台在 ${beijingDate(foundAt)}（北京时间）收录了它。`,
    };
  }
  // A page that gives only a day is stored at UTC midnight: show that day, no time.
  const dateOnly = publishedAt.endsWith("T00:00:00.000Z");
  const hours = (now - Date.parse(publishedAt)) / 3_600_000;
  const age = dateOnly && hours < 24 ? "今天或昨天" : ago(publishedAt, now);
  return {
    freshness: hours <= 24 ? "fresh" : hours <= 48 ? "pool" : "old",
    age,
    at: `${beijingDate(publishedAt, dateOnly)} 发布`,
    title:
      `发布于 ${beijingDate(publishedAt, dateOnly)}${dateOnly ? "（原文只给了日期）" : "（北京时间）"}，${age}。` +
      (hours <= 24
        ? "24 小时内的新内容。"
        : hours <= 48
          ? "超过 24 小时，还在 48 小时候选池里。"
          : "超过 48 小时，算旧闻。"),
  };
}
