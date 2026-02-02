import { StreamType, type WindowWithFS } from '../types/Types';
import { v4 as uuidv4 } from 'uuid';
import { flattenFmp4ToMp4WithOptions } from '../core/index';

export interface DownloadSessionOptions {
  onProgress?: (p: {
    receivedFragments: number;
    expectedFragments?: number;
    bytes: number;
    progressRatio?: number;
  }) => void;
  onKeyframes?: (timestamps: number[]) => void;
}

class FragmentCollector {
  private pc: RTCPeerConnection;
  private cameraId: string;
  private siteId: string;

  constructor(
    pc: RTCPeerConnection,
    cameraId: string,
    siteId: string
  ) {
    this.pc = pc;
    this.cameraId = cameraId;
    this.siteId = siteId;
  }

  async collect(
    startMs: number,
    endMs: number,
    onProgress?: DownloadSessionOptions['onProgress'],
    signal?: AbortSignal
  ): Promise<{ fragments: ArrayBuffer[]; startTimes: number[] }> {

    const fragments: ArrayBuffer[] = [];
    const startTimes: number[] = [];

    let received = 0;
    let bytes = 0;
    let lastSeenStart: number | null = null;
    let lastSeenNextTimestamp: number | null = null;

    const dc = this.pc.createDataChannel(
      `${StreamType.RECORDING}_${uuidv4()}`
    );
    dc.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
      let chunks: Uint8Array[] = [];
      let chunkBytes = 0;

      let resolveCurrentRequest: ((gotFragment: boolean) => void) | null = null;
      const finishCurrentRequest = (gotFragment: boolean) => {
        if (!resolveCurrentRequest) return;
        const r = resolveCurrentRequest;
        resolveCurrentRequest = null;
        r(gotFragment);
      };

      const flush = (forceResolve = false) => {
        if (!chunks.length) {
          if (forceResolve) {
            lastSeenStart = null;
            finishCurrentRequest(false);
          }
          return;
        }

        const merged = new Uint8Array(chunkBytes);
        let off = 0;
        for (const c of chunks) {
          merged.set(c, off);
          off += c.byteLength;
        }

        fragments.push(merged.buffer);
        startTimes.push(lastSeenStart ?? NaN);

        chunks = [];
        chunkBytes = 0;
        lastSeenStart = null;

        received++;

        const durationMs = Math.max(1, endMs - startMs);
        const cursorMs =
          (lastSeenNextTimestamp ?? lastSeenStart ?? startMs);
        const clampedCursorMs = Math.max(startMs, Math.min(endMs, cursorMs));
        const progressRatio = (clampedCursorMs - startMs) / durationMs;

        onProgress?.({
          receivedFragments: received,
          bytes,
          progressRatio,
        });
        finishCurrentRequest(true);
      };

      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        try { dc.close(); } catch {}
        return;
      }

      if (signal) {
        const onAbort = () => {
          reject(new DOMException('Aborted', 'AbortError'));
          try { dc.close(); } catch {}
        };
        const options: AddEventListenerOptions = { once: true };
        signal.addEventListener('abort', onAbort, options);
      }

      dc.onopen = async () => {
        try {
          let requestTimestamp = startMs;
          const maxRequests = 10_000;
          for (let i = 0; i < maxRequests; i++) {
            if (signal?.aborted) {
              throw new DOMException('Aborted', 'AbortError');
            }

            if (requestTimestamp >= endMs) {
              break;
            }

            lastSeenStart = null;
            lastSeenNextTimestamp = null;

            dc.send(JSON.stringify({
              draggedTimeDate: requestTimestamp,
              requestedCameraId: this.cameraId,
              requestedSiteId: this.siteId,
              streamingContentType: 'video',
            }));

            const gotFragment = await new Promise<boolean>((resolveFragment) => {
              resolveCurrentRequest = resolveFragment;
              const timeoutId = setTimeout(() => {
                if (resolveCurrentRequest === resolveFragment) {
                  resolveCurrentRequest = null;
                }
                resolveFragment(false);
              }, 5000);

              const wrappedResolve = (value: boolean) => {
                clearTimeout(timeoutId);
                resolveFragment(value);
              };

              resolveCurrentRequest = wrappedResolve;
            });

            if (!gotFragment) {
              break;
            }

            if (
              lastSeenNextTimestamp === null ||
              !Number.isFinite(lastSeenNextTimestamp) ||
              lastSeenNextTimestamp <= requestTimestamp
            ) {
              break;
            }

            requestTimestamp = lastSeenNextTimestamp;
          }

          if (requestTimestamp >= endMs) {
            onProgress?.({
              receivedFragments: received,
              bytes,
              progressRatio: 1,
            });
          }

          setTimeout(() => {
            try { dc.send(JSON.stringify({ type: 'close' })); } catch {}
            resolve();
          }, 200);
        } catch (e) {
          reject(e);
        }
      };

      dc.onmessage = async (ev) => {
        if (typeof ev.data === 'string') {
          ev.data.split('&').forEach(p => {
            const [k, v] = p.split('=');
            if (!v || Number.isNaN(Number(v))) return;
            if (k === 'START_TIME') {
              lastSeenStart = Number(v);
            }
            if (k === 'NEXT_TIMESTAMP') {
              lastSeenNextTimestamp = Number(v);
            }
          });
          if (ev.data.includes('EOF')) flush(true);
          return;
        }

        const buf =
          ev.data instanceof Blob ? await ev.data.arrayBuffer() : ev.data;

        chunks.push(new Uint8Array(buf));
        chunkBytes += buf.byteLength;
        bytes += buf.byteLength;
      };

      dc.onerror = reject;
      dc.onclose = () => {
        try { dc.close(); } catch {}
        resolve();
      };
    });

    if (!fragments.length) {
      throw new Error('No fragments received');
    }

    return { fragments, startTimes };
  }
}

class FragmentRangeSelector {
  static select(
    fragments: ArrayBuffer[],
    startTimes: number[],
    startMs: number,
    endMs: number
  ): ArrayBuffer[] {
    if (!fragments.length) return [];

    let firstIdx = 0;
    for (let i = 0; i < startTimes.length; i++) {
      const s = startTimes[i];
      const next = i + 1 < startTimes.length ? startTimes[i + 1] : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(s)) continue;

      const segmentEnd = Number.isFinite(next) ? next : Number.POSITIVE_INFINITY;
      const overlaps = s < endMs && segmentEnd > startMs;
      if (overlaps) {
        firstIdx = Math.max(0, i - 1); // decoder pre-roll
        break;
      }
    }

    let lastIdx = fragments.length - 1;
    for (let i = firstIdx; i < startTimes.length; i++) {
      const s = startTimes[i];
      if (Number.isFinite(s) && s >= endMs) {
        lastIdx = Math.max(firstIdx, i - 1);
        break;
      }
    }

    return fragments.slice(firstIdx, lastIdx + 1);
  }
}

export class DownloadSession {
  private pc: RTCPeerConnection;
  private cameraId: string;
  private siteId: string;

  constructor(
    pc: RTCPeerConnection,
    cameraId: string,
    siteId: string
  ) {
    this.pc = pc;
    this.cameraId = cameraId;
    this.siteId = siteId;
  }

  async startDownload(
    startMs: number,
    endMs: number,
    filename = 'clip.mp4',
    opts: DownloadSessionOptions = {},
    signal?: AbortSignal
  ) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const collector = new FragmentCollector(
      this.pc,
      this.cameraId,
      this.siteId
    );

    const { fragments, startTimes } = await collector.collect(
      startMs,
      endMs,
      opts.onProgress,
      signal
    );

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const selected = FragmentRangeSelector.select(
      fragments,
      startTimes,
      startMs,
      endMs
    );

    const { buffer: mp4, idrTimestamps } = await flattenFmp4ToMp4WithOptions(selected, { debug: false, debugFileLimit: 2, normalizeAcrossFiles: true });

    opts.onKeyframes?.(idrTimestamps);

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (typeof window !== 'undefined') {
      const fsWindow = window as WindowWithFS;
      if (fsWindow.showSaveFilePicker) {
        try {
          const handle = await fsWindow.showSaveFilePicker({
            suggestedName: filename,
            types: [
              {
                description: 'MP4',
                accept: { 'video/mp4': ['.mp4'] },
              },
            ],
          });

          const writable = await handle.createWritable();
          await writable.write(mp4);
          await writable.close();
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') {
            return;
          }
        }
      }
    }

    const blob = new Blob([mp4], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
  }
}

export default DownloadSession;