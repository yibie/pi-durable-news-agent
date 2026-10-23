<script setup lang="ts">
// The top bar's 显示 menu: the theme (深色, or 护眼 on warm paper) and the text size. Both are saved with the layout and
// apply at once.
import { onBeforeUnmount, onMounted, ref } from "vue";
import { Palette } from "@lucide/vue";
import { layout, type TextSize, type Theme } from "../client/layout";

const THEMES: { value: Theme; name: string; label: string; hint: string }[] = [
  { value: "dark", name: "深色", label: "Dark theme", hint: "深色背景，适合暗处" },
  {
    value: "paper",
    name: "护眼",
    label: "Eye-care theme",
    hint: "米色纸面、深灰字，适合白天长时间看",
  },
];
const SIZES: { value: TextSize; name: string; label: string }[] = [
  { value: "small", name: "小", label: "Small text" },
  { value: "normal", name: "标准", label: "Normal text" },
  { value: "large", name: "大", label: "Large text" },
];

const open = ref(false);
const root = ref<HTMLElement>();
const close = (e: PointerEvent) => {
  if (open.value && !root.value?.contains(e.target as Node)) open.value = false;
};
onMounted(() => window.addEventListener("pointerdown", close));
onBeforeUnmount(() => window.removeEventListener("pointerdown", close));
</script>

<template>
  <div ref="root" class="display-menu">
    <button
      class="bar-button"
      aria-label="Theme and text size"
      :aria-expanded="open"
      title="显示：深色或护眼主题，文字大小"
      @click="open = !open"
    >
      <Palette :size="16" /><span>显示</span>
    </button>
    <div v-if="open" class="display-pop" role="dialog" aria-label="Display">
      <p class="display-label">主题</p>
      <div class="segmented">
        <button
          v-for="t in THEMES"
          :key="t.value"
          :aria-label="t.label"
          :aria-pressed="layout.theme === t.value"
          :title="t.hint"
          @click="layout.theme = t.value"
        >
          {{ t.name }}
        </button>
      </div>
      <p class="display-label">字号</p>
      <div class="segmented">
        <button
          v-for="s in SIZES"
          :key="s.value"
          :aria-label="s.label"
          :aria-pressed="layout.textSize === s.value"
          @click="layout.textSize = s.value"
        >
          {{ s.name }}
        </button>
      </div>
      <p class="display-hint">选择会记住。在浏览器里按 Cmd 加号或 Cmd 减号，还能整体缩放。</p>
    </div>
  </div>
</template>
