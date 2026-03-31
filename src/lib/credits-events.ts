/**
 * Simple event-based mechanism to trigger AI credits refresh across components.
 * Edge functions return updated credit info; after each AI operation, dispatch
 * this event so the sidebar/header credit display updates immediately.
 */

const AI_CREDITS_CHANGED = "ai-credits-changed";

export function triggerCreditsRefresh() {
  window.dispatchEvent(new Event(AI_CREDITS_CHANGED));
}

export function onCreditsChange(callback: () => void): () => void {
  window.addEventListener(AI_CREDITS_CHANGED, callback);
  return () => window.removeEventListener(AI_CREDITS_CHANGED, callback);
}
