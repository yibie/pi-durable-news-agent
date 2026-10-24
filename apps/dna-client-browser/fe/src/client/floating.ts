// A menu drawn on <body> beside the button that opened it. Cards and the basket clip their overflow, so a menu drawn
// inside them loses options at the edge. Below the button when it fits, else above; if neither fits, the roomier side
// with a scrollbar. Horizontally it starts at the button and is pulled back inside the window. Clicking elsewhere,
// Escape, resizing and a scroll that moves the button close it (a fixed menu would float away from its button). A
// scroll that leaves the button where it was (another pane, the browser keeping the view steady while a line above
// changes) keeps it open.
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

// One option of a ChoiceMenu.
export interface Choice<V> {
  value: V;
  label: string;
  hint?: string;
}

const GAP = 4;
const EDGE = 8;

export function useFloatingMenu<K extends string>() {
  const open = ref<K>();
  const root = ref<HTMLElement>();
  const menu = ref<HTMLElement>();
  const place = ref<Record<string, string>>({});
  let anchor: { el: HTMLElement; top: number; left: number } | undefined;

  async function toggle(which: K, e: MouseEvent) {
    if (open.value === which) return (open.value = undefined);
    const el0 = e.currentTarget as HTMLElement;
    const button = el0.getBoundingClientRect();
    anchor = { el: el0, top: button.top, left: button.left };
    open.value = which;
    // At least as wide as its button (a full-width chooser gets a full-width menu), never under the menu's own minimum.
    const minWidth = `max(240px, ${button.width}px)`;
    place.value = {
      top: `${button.bottom + GAP}px`,
      left: `${button.left}px`,
      minWidth,
      visibility: "hidden",
    };
    await nextTick();
    const el = menu.value;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const below = innerHeight - button.bottom - GAP - EDGE;
    const above = button.top - GAP - EDGE;
    const left = Math.max(EDGE, Math.min(button.left, innerWidth - width - EDGE));
    const next: Record<string, string> = { left: `${left}px`, minWidth };
    if (height <= below || below >= above) {
      next.top = `${button.bottom + GAP}px`;
      if (height > below) next.maxHeight = `${below}px`;
    } else {
      next.top = `${Math.max(EDGE, button.top - GAP - height)}px`;
      if (height > above) next.maxHeight = `${above}px`;
    }
    place.value = next;
  }

  const close = () => (open.value = undefined);
  function onPointer(e: PointerEvent) {
    const t = e.target as Node;
    if (open.value && !root.value?.contains(t) && !menu.value?.contains(t)) close();
  }
  function onKey(e: KeyboardEvent) {
    if (open.value && e.key === "Escape") close();
  }
  function onScroll(e: Event) {
    if (!open.value || menu.value?.contains(e.target as Node)) return;
    const r = anchor?.el.getBoundingClientRect();
    if (!r || Math.abs(r.top - anchor!.top) > 2 || Math.abs(r.left - anchor!.left) > 2) close();
  }
  onMounted(() => {
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("pointerdown", onPointer);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", close);
  });

  return { open, root, menu, place, toggle, close };
}
