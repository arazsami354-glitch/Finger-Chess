import { api } from './api';

function getCanvasHash(): string {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('finger-chess-fp', 2, 2);
    // A short hash of the rendered pixel data is enough to distinguish
    // GPU/driver/font-rendering combinations without storing or
    // transmitting the actual image data anywhere.
    const dataUrl = canvas.toDataURL();
    let hash = 0;
    for (let i = 0; i < dataUrl.length; i++) {
      hash = (hash << 5) - hash + dataUrl.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(16);
  } catch {
    return ''; // canvas blocked by a privacy extension — itself recorded as a tamper flag server-side when empty
  }
}

function getAudioHash(): Promise<string> {
  return new Promise((resolve) => {
    try {
      const AudioCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
      if (!AudioCtx) return resolve('');
      const context = new AudioCtx(1, 5000, 44100);
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(10000, context.currentTime);
      const compressor = context.createDynamicsCompressor();
      oscillator.connect(compressor);
      compressor.connect(context.destination);
      oscillator.start(0);
      context.startRendering();
      context.oncomplete = (event) => {
        const output = event.renderedBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 4500; i < 5000; i++) sum += Math.abs(output[i]);
        resolve(sum.toString(16));
      };
      setTimeout(() => resolve(''), 500); // never let this hang login
    } catch {
      resolve('');
    }
  });
}

export async function collectAndSubmitFingerprint(): Promise<void> {
  try {
    const nav = navigator as any;
    const signals = {
      screenResolution: `${screen.width}x${screen.height}x${screen.colorDepth}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      platform: nav.platform ?? nav.userAgentData?.platform ?? '',
      language: navigator.language,
      languages: [...(navigator.languages ?? [])],
      hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
      deviceMemory: nav.deviceMemory ?? 0,
      canvasHash: getCanvasHash(),
      audioHash: await getAudioHash(),
      webdriver: !!nav.webdriver,
      pluginCount: navigator.plugins?.length ?? 0,
      touchSupport: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    };

    await api.post('/security/fingerprint', signals);
  } catch {
    // Never surfaced to the user — this is a background security signal,
    // not a feature the login flow depends on. A failure here (network
    // hiccup, an aggressive privacy extension blocking the request
    // entirely) shouldn't be visible as an error to someone just trying
    // to log in.
  }
}
