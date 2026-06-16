<template>
  <Teleport to="body">
    <Transition name="m-gallery">
      <div v-if="visible" class="m-gallery" role="dialog" aria-modal="true">
        <button type="button" class="m-gallery__close" aria-label="关闭" @click="close">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>

        <div ref="trackRef" class="m-gallery__track" @scroll.passive="onScroll">
          <div v-for="(item, i) in items" :key="i" class="m-gallery__slide">
            <video
              v-if="item.type === 'video'"
              class="m-gallery__media"
              :src="item.url"
              controls
              playsinline
              preload="metadata"
            ></video>
            <img v-else class="m-gallery__media" :src="item.url" :alt="''" />
          </div>
        </div>

        <div v-if="items.length > 1" class="m-gallery__dots">
          <span v-for="i in items.length" :key="i" class="m-gallery__dot" :class="{ 'is-active': i - 1 === current }"></span>
        </div>

        <div v-if="$slots.actions" class="m-gallery__actions">
          <slot name="actions" :item="items[current]" :index="current"></slot>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'

interface GalleryItem {
  url: string
  type?: 'image' | 'video'
}

const props = withDefaults(defineProps<{
  visible: boolean
  items: GalleryItem[]
  index?: number
}>(), {
  index: 0,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'update:index': [value: number]
}>()

const trackRef = ref<HTMLElement | null>(null)
const current = ref(props.index)

const close = () => emit('update:visible', false)

const onScroll = () => {
  const el = trackRef.value
  if (!el) return
  const idx = Math.round(el.scrollLeft / el.clientWidth)
  if (idx !== current.value) {
    current.value = idx
    emit('update:index', idx)
  }
}

// 打开时滚到目标下标。
watch(() => props.visible, (open) => {
  if (open) {
    current.value = props.index
    nextTick(() => {
      const el = trackRef.value
      if (el) el.scrollLeft = props.index * el.clientWidth
    })
  }
})
</script>

<style scoped>
.m-gallery {
  position: fixed;
  inset: 0;
  z-index: 12000;
  background: #000000;
  display: flex;
  flex-direction: column;
}

.m-gallery__close {
  position: absolute;
  top: calc(8px + env(safe-area-inset-top));
  right: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  color: #ffffff;
  cursor: pointer;
}

.m-gallery__track {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.m-gallery__slide {
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  scroll-snap-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.m-gallery__media {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.m-gallery__dots {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(70px + env(safe-area-inset-bottom));
  display: flex;
  justify-content: center;
  gap: 6px;
}

.m-gallery__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
}

.m-gallery__dot.is-active {
  background: #ffffff;
}

.m-gallery__actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
}

.m-gallery-enter-active,
.m-gallery-leave-active {
  transition: opacity 0.2s ease;
}
.m-gallery-enter-from,
.m-gallery-leave-to {
  opacity: 0;
}
</style>
