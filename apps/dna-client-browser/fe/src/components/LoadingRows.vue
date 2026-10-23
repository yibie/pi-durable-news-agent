<script setup lang="ts">
// Loading placeholders that match what is coming: card rows, list lines, or a block.
withDefaults(
  defineProps<{ kind?: "cards" | "lines" | "block"; count?: number; label?: string }>(),
  {
    kind: "lines",
    count: 3,
    label: "Loading",
  },
);
</script>

<template>
  <div class="loading" :class="kind" role="status" :aria-label="label">
    <template v-if="kind === 'cards'">
      <div v-for="i in count" :key="i" class="feed-row">
        <div class="card sk-card">
          <span class="sk sk-media" />
          <div class="sk-text">
            <span class="sk sk-line short" />
            <span class="sk sk-line" />
            <span class="sk sk-line" />
            <span class="sk sk-line mid" />
          </div>
        </div>
      </div>
    </template>
    <template v-else-if="kind === 'lines'">
      <span v-for="i in count" :key="i" class="sk sk-line" :class="{ mid: i % 2 === 0 }" />
    </template>
    <span v-else class="sk sk-block" />
  </div>
</template>
