// Installability, offline shell, updates and background refresh.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
const listeners = new Set<() => void>();
const swMessageHandlers = new Set<(data: any) => void>();

export const pwa = {
  updateReady: false,
  online: navigator.onLine,
  version: '',
};

function emit(): void {
  listeners.forEach((f) => f());
}

export function onPwa(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function onSwMessage(fn: (data: any) => void): () => void {
  swMessageHandlers.add(fn);
  return () => swMessageHandlers.delete(fn);
}

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export type Platform = 'ios' | 'android' | 'mac-safari' | 'desktop-chromium' | 'firefox' | 'other';

export function platform(): Platform {
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'mac-safari';
  if (/Chrome|Chromium|Edg\//.test(ua)) return 'desktop-chromium';
  return 'other';
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  emit();
  return outcome;
}

export function applyUpdate(): void {
  const waiting = registration?.waiting;
  if (!waiting) {
    location.reload();
    return;
  }
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export function postToSw(msg: unknown): void {
  navigator.serviceWorker?.controller?.postMessage(msg);
}

export async function checkForUpdate(): Promise<void> {
  try {
    await registration?.update();
  } catch {
    /* offline */
  }
}

export async function registerPeriodicRefresh(): Promise<boolean> {
  try {
    const reg = registration as ServiceWorkerRegistration & { periodicSync?: { register(tag: string, o: { minInterval: number }): Promise<void> } };
    if (!reg?.periodicSync) return false;
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
    if (status.state !== 'granted') return false;
    await reg.periodicSync.register('katharos-refresh', { minInterval: 6 * 60 * 60 * 1000 });
    return true;
  } catch {
    return false;
  }
}

export async function enableNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (p === 'granted') await registerPeriodicRefresh();
  return p;
}

export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
  window.addEventListener('online', () => {
    pwa.online = true;
    emit();
  });
  window.addEventListener('offline', () => {
    pwa.online = false;
    emit();
  });

  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  fetch('./version.json', { cache: 'no-store' })
    .then((r) => r.json())
    .then((v: { version: string }) => {
      pwa.version ||= v.version;
      emit();
    })
    .catch(() => {
      /* offline: the service worker reports its version instead */
    });

  // Reload only when a new version replaces an old one — not when the first install takes control.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return;
    refreshing = true;
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'VERSION') {
      pwa.version = e.data.version;
      emit();
    }
    swMessageHandlers.forEach((h) => h(e.data));
  });

  navigator.serviceWorker
    .register('./sw.js', { scope: './', updateViaCache: 'none' })
    .then((reg) => {
      registration = reg;
      const track = (w: ServiceWorker | null) => {
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            pwa.updateReady = true;
            emit();
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) {
        pwa.updateReady = true;
        emit();
      }
      reg.addEventListener('updatefound', () => track(reg.installing));
      navigator.serviceWorker.controller?.postMessage({ type: 'VERSION' });
      void registerPeriodicRefresh();
      // Look for a new version regularly and whenever the app comes back into view.
      setInterval(checkForUpdate, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkForUpdate());
    })
    .catch((err) => console.warn('Service worker registration failed', err));
}
