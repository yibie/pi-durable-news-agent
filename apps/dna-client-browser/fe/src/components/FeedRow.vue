<script setup lang="ts">
// One news row: the card, which the agent can point at with highlight_item. When it was published is in the card's
// top right corner.
import type { Card } from "@dna/sdk";
import { highlighted } from "../client/layout";
import CardView from "./cards/CardView.vue";

defineProps<{ card: Card }>();
</script>

<template>
  <div class="feed-row" :class="{ highlight: highlighted === card.id }" :data-row="card.id">
    <CardView :card="card" />
  </div>
</template>
