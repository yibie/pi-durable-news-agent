<script setup lang="ts">
// The agent: the transcript, then the composer with the context line and the model controls together. While a pick
// is open in the basket, the column shows that pick's writer instead.
import { ui } from "../client/store";
import { openPick } from "../client/writing";
import WriterPanel from "./WriterPanel.vue";
import Composer from "./Composer.vue";
import ModelPicker from "./ModelPicker.vue";
import Transcript from "./Transcript.vue";
</script>

<template>
  <WriterPanel v-if="openPick" />
  <section v-else class="column agent-column" data-col="agent" aria-label="Agent">
    <div class="pane transcript-pane"><Transcript /></div>
    <Composer />
    <ModelPicker v-if="ui.models" />
  </section>
</template>
