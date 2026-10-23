<script setup lang="ts">
// Where a card's item was found, as that site's icon (Hacker News, X, a blog); its name is in the tooltip. A site
// without an icon gets a plain globe. The icon links to the article, as the source name did.
import { computed, ref, watch } from "vue";
import { Globe } from "@lucide/vue";
import type { Card } from "@dna/sdk";
import { clean } from "../client/text";

const props = defineProps<{ card: Card }>();
const failed = ref(false);
watch(
  () => props.card.sourceSite,
  () => (failed.value = false),
);
const site = computed(() => props.card.sourceSite);
const articleHost = computed(() => {
  try {
    return props.card.url ? new URL(props.card.url).hostname.replace(/^www\./, "") : undefined;
  } catch {
    return undefined;
  }
});
const tip = computed(() => {
  const name = clean(props.card.sourceName ?? site.value ?? "网页");
  const host = articleHost.value;
  return host && site.value && !host.endsWith(site.value)
    ? `来源：${name}。原文在 ${host}`
    : `来源：${name}`;
});
</script>

<template>
  <component
    :is="card.url ? 'a' : 'span'"
    class="source-icon"
    :href="card.url"
    :target="card.url ? '_blank' : undefined"
    :rel="card.url ? 'noopener' : undefined"
    :title="tip"
    :aria-label="tip"
    :data-site="site"
  >
    <img
      v-if="site && !failed"
      :src="`/api/v1/favicons/${site}`"
      alt=""
      width="18"
      height="18"
      @error="failed = true"
    />
    <Globe v-else :size="16" />
  </component>
</template>
