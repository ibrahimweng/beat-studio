import type { ScoreSession } from '../../score-session.ts';
import type { AppState } from '../../store.ts';
import { button, el } from '../dom.ts';
import type { View } from '../view.ts';

export interface VideoStageView extends View {
  video: HTMLVideoElement;
}

/**
 * The video being scored.
 *
 * The file is read straight off disk, so nothing is uploaded and the clip
 * never leaves the machine. Its own audio is muted by default and is never
 * part of an export, because the deliverable is the sound you are making.
 */
export function createVideoStage(session: ScoreSession): VideoStageView {
  const video = el('video', {
    class: 'vstage__video',
    attrs: { playsinline: '', preload: 'metadata' },
  });
  video.muted = true;

  const picker = el('input', {
    class: 'vstage__file',
    type: 'file',
    attrs: { accept: 'video/*' },
    on: {
      change: (event) => {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (file) void session.loadVideo(file);
        input.value = '';
      },
    },
  });

  const drop = el('div', { class: 'vstage__drop' }, [
    el('div', { style: { textAlign: 'center' } }, [
      el('div', { class: 'vstage__drop-title', text: 'Drop a video here' }),
      el('div', {
        class: 'vstage__drop-hint',
        text: 'or choose a file. It stays on your machine and is never uploaded.',
      }),
      button({ class: 'chip vstage__pick', on: { click: () => picker.click() } }, ['Choose a video']),
    ]),
  ]);

  const root = el('div', { class: 'vstage' }, [video, drop, picker]);

  // Accept a file dropped anywhere on the stage.
  root.addEventListener('dragover', (event) => {
    event.preventDefault();
    root.classList.add('is-over');
  });
  root.addEventListener('dragleave', () => root.classList.remove('is-over'));
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    root.classList.remove('is-over');
    const file = event.dataTransfer?.files?.[0];
    if (file) void session.loadVideo(file);
  });

  return {
    el: root,
    video,
    update(state: AppState) {
      drop.style.display = state.videoReady ? 'none' : '';
      video.style.display = state.videoReady ? '' : 'none';
    },
  };
}
