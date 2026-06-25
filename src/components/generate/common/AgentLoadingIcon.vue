<template>
  <!-- Agent 加载动画：单个动画 WebP 原生播放（替代原 39 张 PNG 逐帧 base64 内联 + rAF 循环）。 -->
  <div class="agent-loading-icon" :style="{ width: size + 'px', height: size + 'px' }">
    <img :src="agentLoadingWebp" :width="size" :height="size" decoding="async" alt="" />
  </div>
</template>

<script setup lang="ts">
import agentLoadingWebp from '@/assets/image/agent-loading.webp'

withDefaults(defineProps<{
  size?: number
}>(), {
  size: 22,
})
</script>

<style scoped>
.agent-loading-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.agent-loading-icon img {
  display: block;
}
</style>
