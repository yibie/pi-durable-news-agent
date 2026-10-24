<script setup lang="ts" generic="T extends string | number">
// A chooser drawn in the page, in place of a native <select>: the native one opens the system's popup menu, which looks
// out of place here and can't explain its options. The button shows the current choice; the menu lists every option
// with a check on the current one and a hint under each. The shown value always comes from the prop, so a change the
// server refuses leaves the button on what is actually saved.
import { computed } from "vue";
import { Check, ChevronDown } from "@lucide/vue";
import { type Choice, useFloatingMenu } from "../client/floating";

const props = defineProps<{ value: T; options: Choice<T>[]; label: string; title?: string }>();
const emit = defineEmits<{ change: [value: T] }>();
const { open, root, menu, place, toggle, close } = useFloatingMenu<"menu">();
const current = computed(() => props.options.find((o) => o.value === props.value));

function choose(value: T) {
  close();
  if (value !== props.value) emit("change", value);
}
</script>

<template>
  <span ref="root" class="choice">
    <button
      class="choice-button"
      :aria-label="label"
      aria-haspopup="menu"
      :aria-expanded="open === 'menu'"
      :title="title"
      @click="toggle('menu', $event)"
    >
      <span class="choice-current">{{ current?.label ?? value }}</span
      ><ChevronDown :size="14" />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="menu"
        class="pick-menu floating choice-menu"
        role="menu"
        :aria-label="label"
        :style="place"
      >
        <button
          v-for="o in options"
          :key="String(o.value)"
          role="menuitemradio"
          :aria-checked="o.value === value"
          :data-value="o.value"
          @click="choose(o.value)"
        >
          <span class="choice-check"><Check v-if="o.value === value" :size="14" /></span>
          <span class="choice-text"
            ><strong>{{ o.label }}</strong
            ><small v-if="o.hint">{{ o.hint }}</small></span
          >
        </button>
      </div>
    </Teleport>
  </span>
</template>
