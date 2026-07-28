import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWorker {
  static instances = [];

  constructor() {
    this.listeners = { message: [], error: [] };
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
    FakeWorker.instances.push(this);
  }

  addEventListener(type, listener) {
    this.listeners[type].push(listener);
  }

  emitMessage(data) {
    this.listeners.message.forEach(listener => listener({ data }));
  }

  emitError(message) {
    this.listeners.error.forEach(listener => listener({ message }));
  }
}

describe('compressPngInWorker', () => {
  beforeEach(async () => {
    vi.resetModules();
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reuses one worker and resolves the matching transferred response', async () => {
    const { compressPngInWorker } = await import('./pngCompressionWorker');
    const promise = compressPngInWorker(
      new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' })
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    const request = worker.postMessage.mock.calls[0][0];
    const output = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer;
    expect(request).toMatchObject({ mimeType: 'image/png' });
    expect(request).not.toHaveProperty('quality');
    worker.emitMessage({
      id: request.id,
      ok: true,
      buffer: output,
      width: 10,
      height: 10,
      paletteSize: 82,
      lossless: false,
      profile: 'fixed-png-82-v1',
      sourceIsPng: true
    });

    const result = await promise;
    expect(result).toMatchObject({
      blob: expect.objectContaining({ type: 'image/png' }),
      width: 10,
      height: 10,
      paletteSize: 82,
      lossless: false,
      profile: 'fixed-png-82-v1',
      sourceIsPng: true
    });
    expect([...new Uint8Array(await result.blob.arrayBuffer())]).toEqual([
      0x89, 0x50, 0x4e, 0x47
    ]);
    expect(worker.postMessage.mock.calls[0][1]).toEqual([request.buffer]);

    const second = compressPngInWorker(
      new Blob([Uint8Array.from([4])], { type: 'image/png' })
    );
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    const secondRequest = worker.postMessage.mock.calls[1][0];
    worker.emitMessage({
      id: secondRequest.id,
      ok: true,
      buffer: output,
      width: 1,
      height: 1,
      paletteSize: 1,
      lossless: true,
      profile: 'fixed-png-82-v1'
    });

    await expect(second).resolves.toMatchObject({ lossless: true });
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('rejects structured worker failures with their error code', async () => {
    const { compressPngInWorker } = await import('./pngCompressionWorker');
    const promise = compressPngInWorker(
      new Blob([Uint8Array.from([1])], { type: 'image/png' })
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    const request = worker.postMessage.mock.calls[0][0];
    worker.emitMessage({
      id: request.id,
      ok: false,
      error: { code: 'IMAGE_TOO_LARGE', message: 'too large' }
    });

    await expect(promise).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE',
      message: 'too large'
    });
  });

  it('terminates the worker after a codec-load failure and recovers with a replacement', async () => {
    const { compressPngInWorker } = await import('./pngCompressionWorker');
    const first = compressPngInWorker(
      new Blob([Uint8Array.from([1])], { type: 'image/png' })
    );
    const alsoPending = compressPngInWorker(
      new Blob([Uint8Array.from([2])], { type: 'image/png' })
    );
    await vi.waitFor(() =>
      expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(2)
    );
    const failedWorker = FakeWorker.instances[0];
    const failedRequest = failedWorker.postMessage.mock.calls[0][0];
    const firstRejection = expect(first).rejects.toMatchObject({
      code: 'CODEC_LOAD_ERROR'
    });
    const pendingRejection = expect(alsoPending).rejects.toMatchObject({
      code: 'CODEC_LOAD_ERROR'
    });

    failedWorker.emitMessage({
      id: failedRequest.id,
      ok: false,
      error: {
        code: 'CODEC_LOAD_ERROR',
        message: 'codec import failed'
      }
    });

    await Promise.all([firstRejection, pendingRejection]);
    expect(failedWorker.terminate).toHaveBeenCalledOnce();

    const retry = compressPngInWorker(
      new Blob([Uint8Array.from([3])], { type: 'image/png' })
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const replacement = FakeWorker.instances[1];
    const replacementRequest = replacement.postMessage.mock.calls[0][0];
    replacement.emitMessage({
      id: replacementRequest.id,
      ok: true,
      buffer: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer,
      width: 1,
      height: 1,
      paletteSize: 1,
      lossless: true,
      profile: 'fixed-png-82-v1'
    });

    await expect(retry).resolves.toMatchObject({ lossless: true });
  });

  it('rejects pending work and recreates the worker after a fatal error', async () => {
    const { compressPngInWorker } = await import('./pngCompressionWorker');
    const first = compressPngInWorker(
      new Blob([Uint8Array.from([1])], { type: 'image/png' })
    );
    const alsoPending = compressPngInWorker(
      new Blob([Uint8Array.from([2])], { type: 'image/png' })
    );
    await vi.waitFor(() =>
      expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(2)
    );
    const worker = FakeWorker.instances[0];
    const firstRejection = expect(first).rejects.toMatchObject({
      code: 'WORKER_ERROR'
    });
    const secondRejection = expect(alsoPending).rejects.toMatchObject({
      code: 'WORKER_ERROR'
    });
    worker.emitError('worker crashed');
    await Promise.all([firstRejection, secondRejection]);
    expect(worker.terminate).toHaveBeenCalledOnce();

    const second = compressPngInWorker(
      new Blob([Uint8Array.from([3])], { type: 'image/png' })
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const replacement = FakeWorker.instances[1];
    const replacementRequest = replacement.postMessage.mock.calls[0][0];
    replacement.emitMessage({
      id: replacementRequest.id,
      ok: true,
      buffer: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer,
      width: 1,
      height: 1,
      paletteSize: 1,
      lossless: true,
      profile: 'fixed-png-82-v1'
    });
    await expect(second).resolves.toMatchObject({ lossless: true });
  });

  it('times out pending work, terminates the worker, and recovers', async () => {
    vi.useFakeTimers();
    const { PNG_WORKER_TIMEOUT_MS, compressPngInWorker } = await import(
      './pngCompressionWorker'
    );
    const first = compressPngInWorker(
      new Blob([Uint8Array.from([1])], { type: 'image/png' })
    );
    const alsoPending = compressPngInWorker(
      new Blob([Uint8Array.from([2])], { type: 'image/png' })
    );
    await vi.advanceTimersByTimeAsync(0);
    const stuckWorker = FakeWorker.instances[0];
    const firstRejection = expect(first).rejects.toMatchObject({
      code: 'WORKER_TIMEOUT'
    });
    const pendingRejection = expect(alsoPending).rejects.toMatchObject({
      code: 'WORKER_TIMEOUT'
    });

    await vi.advanceTimersByTimeAsync(PNG_WORKER_TIMEOUT_MS);
    await Promise.all([firstRejection, pendingRejection]);
    expect(stuckWorker.terminate).toHaveBeenCalledOnce();

    const retry = compressPngInWorker(
      new Blob([Uint8Array.from([3])], { type: 'image/png' })
    );
    await vi.advanceTimersByTimeAsync(0);
    const replacement = FakeWorker.instances[1];
    const request = replacement.postMessage.mock.calls[0][0];
    replacement.emitMessage({
      id: request.id,
      ok: true,
      buffer: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer,
      width: 1,
      height: 1,
      paletteSize: 1,
      lossless: true,
      profile: 'fixed-png-82-v1'
    });

    await expect(retry).resolves.toMatchObject({ lossless: true });
  });

  it('ignores a queued error from a timed-out worker after replacement', async () => {
    vi.useFakeTimers();
    const { PNG_WORKER_TIMEOUT_MS, compressPngInWorker } = await import(
      './pngCompressionWorker'
    );
    const first = compressPngInWorker(
      new Blob([Uint8Array.from([1])], { type: 'image/png' })
    );
    await vi.advanceTimersByTimeAsync(0);
    const timedOutWorker = FakeWorker.instances[0];
    const firstRejection = expect(first).rejects.toMatchObject({
      code: 'WORKER_TIMEOUT'
    });

    await vi.advanceTimersByTimeAsync(PNG_WORKER_TIMEOUT_MS);
    await firstRejection;

    const retry = compressPngInWorker(
      new Blob([Uint8Array.from([2])], { type: 'image/png' })
    );
    await vi.advanceTimersByTimeAsync(0);
    const replacement = FakeWorker.instances[1];
    const request = replacement.postMessage.mock.calls[0][0];
    let retryError;
    const guardedRetry = retry.catch(error => {
      retryError = error;
      return null;
    });

    timedOutWorker.emitError('queued stale error');
    expect(replacement.terminate).not.toHaveBeenCalled();

    replacement.emitMessage({
      id: request.id,
      ok: true,
      buffer: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer,
      width: 1,
      height: 1,
      paletteSize: 1,
      lossless: true,
      profile: 'fixed-png-82-v1'
    });

    expect(await guardedRetry).toMatchObject({ lossless: true });
    expect(retryError).toBeUndefined();
    expect(replacement.terminate).not.toHaveBeenCalled();
  });

  it('clears operation timers after success and structured failure', async () => {
    vi.useFakeTimers();
    const { PNG_WORKER_TIMEOUT_MS, compressPngInWorker } = await import(
      './pngCompressionWorker'
    );
    const success = compressPngInWorker(
      new Blob([Uint8Array.from([1])], { type: 'image/png' })
    );
    await vi.advanceTimersByTimeAsync(0);
    const worker = FakeWorker.instances[0];
    const successRequest = worker.postMessage.mock.calls[0][0];
    worker.emitMessage({
      id: successRequest.id,
      ok: true,
      buffer: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer,
      profile: 'fixed-png-82-v1'
    });
    await success;

    const failure = compressPngInWorker(
      new Blob([Uint8Array.from([2])], { type: 'image/png' })
    );
    await vi.advanceTimersByTimeAsync(0);
    const failureRequest = worker.postMessage.mock.calls[1][0];
    worker.emitMessage({
      id: failureRequest.id,
      ok: false,
      error: { code: 'INVALID_IMAGE', message: 'invalid' }
    });
    await expect(failure).rejects.toMatchObject({ code: 'INVALID_IMAGE' });

    await vi.advanceTimersByTimeAsync(PNG_WORKER_TIMEOUT_MS);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('normalizes a synchronous constructor failure and retries with a replacement', async () => {
    let constructionAttempts = 0;
    class ConstructorThrowWorker extends FakeWorker {
      constructor() {
        constructionAttempts++;
        if (constructionAttempts === 1) throw new Error('constructor failed');
        super();
      }
    }
    vi.stubGlobal('Worker', ConstructorThrowWorker);
    const { compressPngInWorker } = await import('./pngCompressionWorker');

    await expect(
      compressPngInWorker(
        new Blob([Uint8Array.from([1])], { type: 'image/png' })
      )
    ).rejects.toMatchObject({
      code: 'WORKER_ERROR',
      message: 'constructor failed'
    });

    const retry = compressPngInWorker(
      new Blob([Uint8Array.from([2])], { type: 'image/png' })
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const replacement = FakeWorker.instances[0];
    const request = replacement.postMessage.mock.calls[0][0];
    replacement.emitMessage({
      id: request.id,
      ok: true,
      buffer: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer,
      width: 1,
      height: 1,
      paletteSize: 1,
      lossless: true,
      profile: 'fixed-png-82-v1'
    });

    await expect(retry).resolves.toMatchObject({ lossless: true });
  });

  it('terminates a partially configured worker after listener setup fails', async () => {
    let listenerAttempts = 0;
    class ListenerThrowWorker extends FakeWorker {
      addEventListener(type, listener) {
        listenerAttempts++;
        if (listenerAttempts === 1) throw new Error('listener setup failed');
        super.addEventListener(type, listener);
      }
    }
    vi.stubGlobal('Worker', ListenerThrowWorker);
    const { compressPngInWorker } = await import('./pngCompressionWorker');

    await expect(
      compressPngInWorker(
        new Blob([Uint8Array.from([1])], { type: 'image/png' })
      )
    ).rejects.toMatchObject({
      code: 'WORKER_ERROR',
      message: 'listener setup failed'
    });
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();

    const retry = compressPngInWorker(
      new Blob([Uint8Array.from([2])], { type: 'image/png' })
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const replacement = FakeWorker.instances[1];
    const request = replacement.postMessage.mock.calls[0][0];
    replacement.emitMessage({
      id: request.id,
      ok: true,
      buffer: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer,
      width: 1,
      height: 1,
      paletteSize: 1,
      lossless: true,
      profile: 'fixed-png-82-v1'
    });

    await expect(retry).resolves.toMatchObject({ lossless: true });
  });

  it('clears pending work after a synchronous postMessage failure and recovers', async () => {
    const { compressPngInWorker } = await import('./pngCompressionWorker');
    const pending = compressPngInWorker(
      new Blob([Uint8Array.from([1])], { type: 'image/png' })
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const failedWorker = FakeWorker.instances[0];
    await vi.waitFor(() =>
      expect(failedWorker.postMessage).toHaveBeenCalledOnce()
    );
    failedWorker.postMessage.mockImplementationOnce(() => {
      throw new Error('postMessage failed');
    });

    const trigger = compressPngInWorker(
      new Blob([Uint8Array.from([2])], { type: 'image/png' })
    );
    const pendingRejection = expect(pending).rejects.toMatchObject({
      code: 'WORKER_ERROR',
      message: 'postMessage failed'
    });
    const triggerRejection = expect(trigger).rejects.toMatchObject({
      code: 'WORKER_ERROR',
      message: 'postMessage failed'
    });

    await Promise.all([pendingRejection, triggerRejection]);
    expect(failedWorker.terminate).toHaveBeenCalledOnce();

    const retry = compressPngInWorker(
      new Blob([Uint8Array.from([3])], { type: 'image/png' })
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const replacement = FakeWorker.instances[1];
    const request = replacement.postMessage.mock.calls[0][0];
    replacement.emitMessage({
      id: request.id,
      ok: true,
      buffer: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer,
      width: 1,
      height: 1,
      paletteSize: 1,
      lossless: true,
      profile: 'fixed-png-82-v1'
    });

    await expect(retry).resolves.toMatchObject({ lossless: true });
  });

  it('rejects when Web Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const { compressPngInWorker } = await import('./pngCompressionWorker');

    await expect(
      compressPngInWorker(new Blob([Uint8Array.from([1])]))
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_BROWSER' });
    expect(FakeWorker.instances).toHaveLength(0);
  });
});
