import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWorker {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
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

const ascii = value => Uint8Array.from(value, character => character.charCodeAt(0));

const makeAvif = () => {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(ascii('ftyp'), 4);
  bytes.set(ascii('avif'), 8);
  return bytes.buffer;
};

const makeJxl = () => Uint8Array.from([0xff, 0x0a, 0x01]).buffer;

const sourceBlob = bytes =>
  new Blob([Uint8Array.from(bytes)], { type: 'image/png' });

const fakeSource = () => ({
  type: 'image/png',
  arrayBuffer: vi.fn().mockImplementation(async () => new ArrayBuffer(1))
});

const deferredSource = byte => {
  const buffer = Uint8Array.from([byte]).buffer;
  let resolveBuffer;
  const bufferPromise = new Promise(resolve => {
    resolveBuffer = resolve;
  });

  return {
    blob: {
      type: 'image/png',
      arrayBuffer: vi.fn(() => bufferPromise)
    },
    buffer,
    byte,
    resolve: () => resolveBuffer(buffer)
  };
};

const totalPostedRequestCount = () =>
  FakeWorker.instances.reduce(
    (total, worker) => total + worker.postMessage.mock.calls.length,
    0
  );

const expectPostedSource = (worker, source) => {
  const call = worker.postMessage.mock.calls.find(
    ([request]) => request.buffer === source.buffer
  );
  expect(call).toBeDefined();
  const [request, transfer] = call;
  expect(request.buffer).toBe(source.buffer);
  expect([...new Uint8Array(request.buffer)]).toEqual([source.byte]);
  expect(transfer).toHaveLength(1);
  expect(transfer[0]).toBe(source.buffer);
  return request;
};

const emitSuccess = (worker, request, overrides = {}) => {
  const isAvif = request.format === 'avif';
  worker.emitMessage({
    id: request.id,
    ok: true,
    buffer: isAvif ? makeAvif() : makeJxl(),
    mimeType: isAvif ? 'image/avif' : 'image/jxl',
    width: 1,
    height: 1,
    ...overrides
  });
};

describe('compressModernImageInWorker', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('navigator', {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    [4, 2],
    [8, 2],
    [3, 1],
    [undefined, 1],
    [null, 1],
    ['8', 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [-1, 1],
    [4.5, 1]
  ])(
    'selects worker pool capacity %s -> %s',
    async (hardwareConcurrency, expectedCapacity) => {
      const { getModernImageWorkerPoolCapacity } = await import(
        './modernImageCompressionWorker'
      );

      expect(getModernImageWorkerPoolCapacity(hardwareConcurrency)).toBe(
        expectedCapacity
      );
    }
  );

  it.each([
    [8, 2],
    [3, 1],
    [undefined, 1]
  ])(
    'exports runtime pool capacity for hardware concurrency %s -> %s',
    async (hardwareConcurrency, expectedCapacity) => {
      vi.stubGlobal('navigator', { hardwareConcurrency });
      const { MODERN_IMAGE_WORKER_POOL_CAPACITY } = await import(
        './modernImageCompressionWorker'
      );

      expect(MODERN_IMAGE_WORKER_POOL_CAPACITY).toBe(expectedCapacity);
    }
  );

  it('creates the first worker lazily and does not prewarm a second high-CPU slot', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );

    expect(FakeWorker.instances).toHaveLength(0);
    const pending = compressModernImageInWorker(sourceBlob([1]), 'avif', 50);
    await vi.waitFor(() =>
      expect(FakeWorker.instances[0]?.postMessage).toHaveBeenCalledOnce()
    );
    expect(FakeWorker.instances).toHaveLength(1);

    const worker = FakeWorker.instances[0];
    emitSuccess(worker, worker.postMessage.mock.calls[0][0]);
    await expect(pending).resolves.toMatchObject({ width: 1, height: 1 });
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('routes two concurrent high-CPU requests to distinct workers', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );

    const invokedFirstSource = deferredSource(11);
    const invokedSecondSource = deferredSource(22);
    const invokedFirst = compressModernImageInWorker(
      invokedFirstSource.blob,
      'avif',
      35
    );
    const invokedSecond = compressModernImageInWorker(
      invokedSecondSource.blob,
      'jxl',
      75
    );

    invokedSecondSource.resolve();
    await vi.waitFor(() => expect(totalPostedRequestCount()).toBe(1));
    invokedFirstSource.resolve();
    await vi.waitFor(() => expect(totalPostedRequestCount()).toBe(2));

    const [firstWorker, secondWorker] = FakeWorker.instances;
    expect(FakeWorker.instances).toHaveLength(2);
    const invokedSecondRequest = expectPostedSource(
      firstWorker,
      invokedSecondSource
    );
    const invokedFirstRequest = expectPostedSource(
      secondWorker,
      invokedFirstSource
    );
    emitSuccess(firstWorker, invokedSecondRequest, { width: 22 });
    emitSuccess(secondWorker, invokedFirstRequest, { width: 11 });

    await expect(invokedFirst).resolves.toMatchObject({ width: 11 });
    await expect(invokedSecond).resolves.toMatchObject({ width: 22 });
  });

  it('reuses the least-loaded warm worker', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );

    const invokedFirstSource = deferredSource(31);
    const invokedSecondSource = deferredSource(32);
    const invokedFirst = compressModernImageInWorker(
      invokedFirstSource.blob,
      'avif',
      35
    );
    const invokedSecond = compressModernImageInWorker(
      invokedSecondSource.blob,
      'jxl',
      75
    );
    invokedSecondSource.resolve();
    await vi.waitFor(() => expect(totalPostedRequestCount()).toBe(1));
    invokedFirstSource.resolve();
    await vi.waitFor(() => expect(totalPostedRequestCount()).toBe(2));

    const [firstWorker, secondWorker] = FakeWorker.instances;
    const invokedSecondRequest = expectPostedSource(
      firstWorker,
      invokedSecondSource
    );
    expectPostedSource(secondWorker, invokedFirstSource);
    emitSuccess(firstWorker, invokedSecondRequest);
    await invokedSecond;

    const thirdSource = deferredSource(33);
    const third = compressModernImageInWorker(thirdSource.blob, 'avif', 50);
    thirdSource.resolve();
    await vi.waitFor(() => expect(totalPostedRequestCount()).toBe(3));
    const thirdRequest = expectPostedSource(firstWorker, thirdSource);
    expect(firstWorker.postMessage).toHaveBeenCalledTimes(2);
    expect(secondWorker.postMessage).toHaveBeenCalledOnce();
    expect(FakeWorker.instances).toHaveLength(2);

    emitSuccess(firstWorker, thirdRequest);
    emitSuccess(
      secondWorker,
      expectPostedSource(secondWorker, invokedFirstSource)
    );
    await expect(Promise.all([invokedFirst, third])).resolves.toHaveLength(2);
  });

  it('never creates a third worker and balances additional active requests', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 12 });
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );

    const sources = [41, 42, 43, 44, 45].map(deferredSource);
    const requests = sources.map((source, index) =>
      compressModernImageInWorker(
        source.blob,
        index % 2 === 0 ? 'avif' : 'jxl',
        50
      )
    );
    const resolutionOrder = [sources[3], sources[1], sources[4], sources[0], sources[2]];
    for (const [index, source] of resolutionOrder.entries()) {
      source.resolve();
      await vi.waitFor(() => expect(totalPostedRequestCount()).toBe(index + 1));
    }

    expect(FakeWorker.instances).toHaveLength(2);
    const [firstWorker, secondWorker] = FakeWorker.instances;
    expect(firstWorker.postMessage).toHaveBeenCalledTimes(3);
    expect(secondWorker.postMessage).toHaveBeenCalledTimes(2);
    [sources[3], sources[4], sources[2]].forEach(source => {
      expectPostedSource(firstWorker, source);
    });
    [sources[1], sources[0]].forEach(source => {
      expectPostedSource(secondWorker, source);
    });

    FakeWorker.instances.forEach(worker => {
      worker.postMessage.mock.calls.forEach(([request]) => {
        emitSuccess(worker, request);
      });
    });
    await expect(Promise.all(requests)).resolves.toHaveLength(5);
  });

  it.each([undefined, 3])(
    'uses one worker for low or unknown hardware concurrency %s',
    async hardwareConcurrency => {
      vi.stubGlobal('navigator', { hardwareConcurrency });
      const { compressModernImageInWorker } = await import(
        './modernImageCompressionWorker'
      );

      const first = compressModernImageInWorker(sourceBlob([1]), 'avif', 35);
      const second = compressModernImageInWorker(sourceBlob([2]), 'jxl', 75);
      await vi.waitFor(() =>
        expect(FakeWorker.instances[0]?.postMessage).toHaveBeenCalledTimes(2)
      );
      const worker = FakeWorker.instances[0];
      expect(FakeWorker.instances).toHaveLength(1);

      worker.postMessage.mock.calls.forEach(([request]) => {
        emitSuccess(worker, request);
      });
      await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    }
  );

  it('isolates a fatal owner error, replaces that owner, and ignores its stale events', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );

    const peerFirstSource = deferredSource(51);
    const failedFirstSource = deferredSource(52);
    const peerSecondSource = deferredSource(53);
    const failedSecondSource = deferredSource(54);
    const peerFirst = compressModernImageInWorker(
      peerFirstSource.blob,
      'avif',
      50
    );
    const failedFirst = compressModernImageInWorker(
      failedFirstSource.blob,
      'jxl',
      50
    );
    const peerSecond = compressModernImageInWorker(
      peerSecondSource.blob,
      'jxl',
      50
    );
    const failedSecond = compressModernImageInWorker(
      failedSecondSource.blob,
      'avif',
      50
    );

    const resolutionOrder = [
      failedFirstSource,
      peerSecondSource,
      failedSecondSource,
      peerFirstSource
    ];
    for (const [index, source] of resolutionOrder.entries()) {
      source.resolve();
      await vi.waitFor(() => expect(totalPostedRequestCount()).toBe(index + 1));
    }

    const [failedWorker, survivingWorker] = FakeWorker.instances;
    expectPostedSource(failedWorker, failedFirstSource);
    expectPostedSource(failedWorker, failedSecondSource);
    const peerFirstRequest = expectPostedSource(
      survivingWorker,
      peerFirstSource
    );
    const peerSecondRequest = expectPostedSource(
      survivingWorker,
      peerSecondSource
    );
    const failedRejections = [
      expect(failedFirst).rejects.toMatchObject({ code: 'WORKER_ERROR' }),
      expect(failedSecond).rejects.toMatchObject({ code: 'WORKER_ERROR' })
    ];

    failedWorker.emitError('private owner crash');
    await Promise.all(failedRejections);
    expect(failedWorker.terminate).toHaveBeenCalledOnce();
    expect(survivingWorker.terminate).not.toHaveBeenCalled();

    const replacementSource = deferredSource(55);
    const replacementWork = compressModernImageInWorker(
      replacementSource.blob,
      'avif',
      50
    );
    replacementSource.resolve();
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(3));
    const replacement = FakeWorker.instances[2];
    const replacementRequest = expectPostedSource(
      replacement,
      replacementSource
    );
    const peerFirstCompletion = expect(peerFirst).resolves.toMatchObject({
      width: 51
    });
    const peerSecondCompletion = expect(peerSecond).resolves.toMatchObject({
      width: 53
    });
    const replacementCompletion = expect(replacementWork).resolves.toMatchObject(
      { width: 55 }
    );

    failedWorker.emitError('queued stale crash');
    failedWorker.emitMessage({
      id: replacementRequest.id,
      ok: false,
      code: 'ENCODE_ERROR'
    });
    expect(survivingWorker.terminate).not.toHaveBeenCalled();
    expect(replacement.terminate).not.toHaveBeenCalled();

    emitSuccess(survivingWorker, peerFirstRequest, { width: 51 });
    emitSuccess(survivingWorker, peerSecondRequest, { width: 53 });
    emitSuccess(replacement, replacementRequest, { width: 55 });

    await Promise.all([
      peerFirstCompletion,
      peerSecondCompletion,
      replacementCompletion
    ]);
    expect(FakeWorker.instances).toHaveLength(3);
  });

  it('isolates an owner timeout while its peer and replacement complete', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const {
      MODERN_IMAGE_WORKER_TIMEOUT_MS,
      compressModernImageInWorker
    } = await import('./modernImageCompressionWorker');
    const timedOut = compressModernImageInWorker(sourceBlob([1]), 'avif', 35);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1);
    const surviving = compressModernImageInWorker(sourceBlob([2]), 'jxl', 75);
    await vi.advanceTimersByTimeAsync(0);
    const [timedOutWorker, survivingWorker] = FakeWorker.instances;
    const timeoutRejection = expect(timedOut).rejects.toMatchObject({
      code: 'WORKER_TIMEOUT'
    });

    await vi.advanceTimersByTimeAsync(MODERN_IMAGE_WORKER_TIMEOUT_MS - 1);
    await timeoutRejection;
    expect(timedOutWorker.terminate).toHaveBeenCalledOnce();
    expect(survivingWorker.terminate).not.toHaveBeenCalled();

    const replacementWork = compressModernImageInWorker(
      sourceBlob([3]),
      'avif',
      50
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWorker.instances).toHaveLength(3);
    const replacement = FakeWorker.instances[2];

    timedOutWorker.emitError('queued stale timeout crash');
    emitSuccess(survivingWorker, survivingWorker.postMessage.mock.calls[0][0]);
    emitSuccess(replacement, replacement.postMessage.mock.calls[0][0]);

    await expect(Promise.all([surviving, replacementWork])).resolves.toHaveLength(
      2
    );
    expect(survivingWorker.terminate).not.toHaveBeenCalled();
    expect(replacement.terminate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['success', null],
    ['structured nonfatal failure', 'ENCODE_ERROR']
  ])(
    'routes new work to the owner freed by %s while its peer remains busy',
    async (_settlement, failureCode) => {
      vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
      const { compressModernImageInWorker } = await import(
        './modernImageCompressionWorker'
      );
      const settlingSource = deferredSource(61);
      const busySource = deferredSource(62);
      const settlingWork = compressModernImageInWorker(
        settlingSource.blob,
        'jxl',
        50
      );
      const busyWork = compressModernImageInWorker(
        busySource.blob,
        'avif',
        50
      );

      busySource.resolve();
      await vi.waitFor(() => expect(totalPostedRequestCount()).toBe(1));
      settlingSource.resolve();
      await vi.waitFor(() => expect(totalPostedRequestCount()).toBe(2));
      const [busyWorker, settlingWorker] = FakeWorker.instances;
      const busyRequest = expectPostedSource(busyWorker, busySource);
      const settlingRequest = expectPostedSource(
        settlingWorker,
        settlingSource
      );

      if (failureCode) {
        const rejection = expect(settlingWork).rejects.toMatchObject({
          code: failureCode
        });
        settlingWorker.emitMessage({
          id: settlingRequest.id,
          ok: false,
          code: failureCode
        });
        await rejection;
      } else {
        emitSuccess(settlingWorker, settlingRequest);
        await expect(settlingWork).resolves.toMatchObject({ width: 1 });
      }

      const nextSource = deferredSource(63);
      const nextWork = compressModernImageInWorker(
        nextSource.blob,
        'avif',
        50
      );
      nextSource.resolve();
      await vi.waitFor(() => expect(totalPostedRequestCount()).toBe(3));

      expect(busyWorker.postMessage).toHaveBeenCalledOnce();
      expect(settlingWorker.postMessage).toHaveBeenCalledTimes(2);
      expect(FakeWorker.instances).toHaveLength(2);
      const nextRequest = expectPostedSource(settlingWorker, nextSource);

      emitSuccess(busyWorker, busyRequest);
      emitSuccess(settlingWorker, nextRequest);
      await expect(Promise.all([busyWork, nextWork])).resolves.toHaveLength(2);
      expect(busyWorker.terminate).not.toHaveBeenCalled();
      expect(settlingWorker.terminate).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['avif', 35, 'image/avif', makeAvif],
    ['jxl', 75, 'image/jxl', makeJxl]
  ])(
    'uses one module worker and resolves validated %s bytes',
    async (format, quality, mimeType, makeOutput) => {
      const { compressModernImageInWorker } = await import(
        './modernImageCompressionWorker'
      );
      const promise = compressModernImageInWorker(
        sourceBlob([1, 2, 3]),
        format,
        quality
      );
      await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
      const worker = FakeWorker.instances[0];
      const request = worker.postMessage.mock.calls[0][0];
      const output = makeOutput();

      expect(worker.options).toEqual({ type: 'module' });
      expect(worker.url).toBeInstanceOf(URL);
      expect(worker.url.pathname).toMatch(/modernImageCompression\.worker\.js$/);
      expect(request).toMatchObject({
        mimeType: 'image/png',
        format,
        quality
      });
      expect(worker.postMessage.mock.calls[0][1]).toEqual([request.buffer]);

      worker.emitMessage({
        id: request.id,
        ok: true,
        buffer: output,
        mimeType,
        width: 2,
        height: 3
      });

      const result = await promise;
      expect(result).toMatchObject({
        blob: expect.objectContaining({ type: mimeType }),
        width: 2,
        height: 3
      });
      expect(await result.blob.arrayBuffer()).toEqual(output);
    }
  );

  it('reuses the active worker for later requests', async () => {
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );
    const first = compressModernImageInWorker(sourceBlob([1]), 'avif', 35);
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    const firstRequest = worker.postMessage.mock.calls[0][0];
    worker.emitMessage({
      id: firstRequest.id,
      ok: true,
      buffer: makeAvif(),
      mimeType: 'image/avif',
      width: 1,
      height: 1
    });
    await first;

    const second = compressModernImageInWorker(sourceBlob([2]), 'jxl', 50);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    const secondRequest = worker.postMessage.mock.calls[1][0];
    worker.emitMessage({
      id: secondRequest.id,
      ok: true,
      buffer: makeJxl(),
      mimeType: 'image/jxl',
      width: 1,
      height: 1
    });

    await expect(second).resolves.toMatchObject({ width: 1, height: 1 });
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it.each(['INVALID_IMAGE', 'IMAGE_TOO_LARGE'])(
    'maps structured %s failures without terminating healthy workers',
    async code => {
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );
    const promise = compressModernImageInWorker(sourceBlob([1]), 'avif', 50);
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    const request = worker.postMessage.mock.calls[0][0];

    worker.emitMessage({
      id: request.id,
      ok: false,
      code,
      details: 'private worker detail'
    });

    const error = await promise.catch(value => value);
    expect(error).toMatchObject({ code });
    expect(error.message).not.toContain('private worker detail');
    expect(worker.terminate).not.toHaveBeenCalled();
    }
  );

  it('rejects the full generation, clears timers, and recovers after CODEC_LOAD_ERROR', async () => {
    vi.useFakeTimers();
    const {
      MODERN_IMAGE_WORKER_TIMEOUT_MS,
      compressModernImageInWorker
    } = await import('./modernImageCompressionWorker');
    const first = compressModernImageInWorker(sourceBlob([1]), 'avif', 35);
    const alsoPending = compressModernImageInWorker(sourceBlob([2]), 'jxl', 75);
    await vi.advanceTimersByTimeAsync(0);
    const failedWorker = FakeWorker.instances[0];
    const request = failedWorker.postMessage.mock.calls[0][0];
    const firstRejection = expect(first).rejects.toMatchObject({
      code: 'CODEC_LOAD_ERROR'
    });
    const pendingRejection = expect(alsoPending).rejects.toMatchObject({
      code: 'CODEC_LOAD_ERROR'
    });

    failedWorker.emitMessage({
      id: request.id,
      ok: false,
      code: 'CODEC_LOAD_ERROR'
    });

    await Promise.all([firstRejection, pendingRejection]);
    expect(failedWorker.terminate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(MODERN_IMAGE_WORKER_TIMEOUT_MS);
    expect(failedWorker.terminate).toHaveBeenCalledOnce();

    const retry = compressModernImageInWorker(sourceBlob([3]), 'avif', 50);
    await vi.advanceTimersByTimeAsync(0);
    const replacement = FakeWorker.instances[1];
    const retryRequest = replacement.postMessage.mock.calls[0][0];
    replacement.emitMessage({
      id: retryRequest.id,
      ok: true,
      buffer: makeAvif(),
      mimeType: 'image/avif',
      width: 1,
      height: 1
    });

    await expect(retry).resolves.toMatchObject({ width: 1, height: 1 });
  });

  it('rejects wrong worker MIME before Blob construction and replaces the worker', async () => {
    const BlobConstructor = vi.fn();
    vi.stubGlobal(
      'Blob',
      class {
        constructor(...args) {
          BlobConstructor(...args);
        }
      }
    );
    const source = {
      type: 'image/png',
      arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([1]).buffer)
    };
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );
    const first = compressModernImageInWorker(source, 'avif', 50);
    const alsoPending = compressModernImageInWorker(source, 'jxl', 50);
    await vi.waitFor(() =>
      expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(2)
    );
    const failedWorker = FakeWorker.instances[0];
    const request = failedWorker.postMessage.mock.calls[0][0];
    const firstRejection = expect(first).rejects.toMatchObject({
      code: 'ENCODE_ERROR'
    });
    const pendingRejection = expect(alsoPending).rejects.toMatchObject({
      code: 'ENCODE_ERROR'
    });

    failedWorker.emitMessage({
      id: request.id,
      ok: true,
      buffer: makeAvif(),
      mimeType: 'image/jpeg',
      width: 1,
      height: 1
    });

    await Promise.all([firstRejection, pendingRejection]);
    expect(BlobConstructor).not.toHaveBeenCalled();
    expect(failedWorker.terminate).toHaveBeenCalledOnce();

    const retry = compressModernImageInWorker(source, 'avif', 50);
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const replacement = FakeWorker.instances[1];
    const retryRequest = replacement.postMessage.mock.calls[0][0];
    replacement.emitMessage({
      id: retryRequest.id,
      ok: true,
      buffer: makeAvif(),
      mimeType: 'image/avif',
      width: 1,
      height: 1
    });
    await expect(retry).resolves.toMatchObject({ width: 1, height: 1 });
  });

  it('rejects a wrong worker signature rather than relabeling it', async () => {
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );
    const promise = compressModernImageInWorker(sourceBlob([1]), 'jxl', 50);
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    const request = worker.postMessage.mock.calls[0][0];

    worker.emitMessage({
      id: request.id,
      ok: true,
      buffer: Uint8Array.from([0xff, 0xd8, 0xff]).buffer,
      mimeType: 'image/jxl',
      width: 1,
      height: 1
    });

    await expect(promise).rejects.toMatchObject({ code: 'ENCODE_ERROR' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each([
    ['non-ArrayBuffer output', { buffer: Uint8Array.from([0xff, 0x0a]) }],
    ['zero width', { width: 0 }],
    ['negative height', { height: -1 }],
    ['fractional width', { width: 1.5 }],
    ['NaN height', { height: Number.NaN }],
    ['infinite width', { width: Number.POSITIVE_INFINITY }]
  ])(
    'treats malformed success with %s as a fatal generation failure',
    async (_label, overrides) => {
      vi.useFakeTimers();
      const BlobConstructor = vi.fn();
      vi.stubGlobal(
        'Blob',
        class {
          constructor(...args) {
            BlobConstructor(...args);
            this.type = args[1]?.type || '';
          }
        }
      );
      const source = fakeSource();
      const {
        MODERN_IMAGE_WORKER_TIMEOUT_MS,
        compressModernImageInWorker
      } = await import('./modernImageCompressionWorker');
      const first = compressModernImageInWorker(source, 'jxl', 50);
      const alsoPending = compressModernImageInWorker(source, 'avif', 50);
      await vi.advanceTimersByTimeAsync(0);
      const failedWorker = FakeWorker.instances[0];
      const request = failedWorker.postMessage.mock.calls[0][0];
      const firstRejection = expect(first).rejects.toMatchObject({
        code: 'ENCODE_ERROR'
      });
      const pendingRejection = expect(alsoPending).rejects.toMatchObject({
        code: 'ENCODE_ERROR'
      });

      failedWorker.emitMessage({
        id: request.id,
        ok: true,
        buffer: makeJxl(),
        mimeType: 'image/jxl',
        width: 1,
        height: 1,
        ...overrides
      });

      await Promise.all([firstRejection, pendingRejection]);
      expect(BlobConstructor).not.toHaveBeenCalled();
      expect(failedWorker.terminate).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(MODERN_IMAGE_WORKER_TIMEOUT_MS);
      expect(failedWorker.terminate).toHaveBeenCalledOnce();

      const retry = compressModernImageInWorker(source, 'avif', 50);
      await vi.advanceTimersByTimeAsync(0);
      const replacement = FakeWorker.instances[1];
      const retryRequest = replacement.postMessage.mock.calls[0][0];
      replacement.emitMessage({
        id: retryRequest.id,
        ok: true,
        buffer: makeAvif(),
        mimeType: 'image/avif',
        width: 1,
        height: 1
      });

      await expect(retry).resolves.toMatchObject({ width: 1, height: 1 });
      expect(BlobConstructor).toHaveBeenCalledOnce();
    }
  );

  it.each([
    ['null message', null],
    ['string message', 'invalid'],
    ['zero id', { id: 0, ok: false, code: 'ENCODE_ERROR' }],
    ['fractional id', { id: 1.5, ok: false, code: 'ENCODE_ERROR' }],
    [
      'unknown positive id outside its issued range',
      { id: 999, ok: false, code: 'ENCODE_ERROR' }
    ]
  ])(
    'treats active-worker %s as fatal WORKER_ERROR',
    async (_label, response) => {
      const { compressModernImageInWorker } = await import(
        './modernImageCompressionWorker'
      );
      const first = compressModernImageInWorker(sourceBlob([1]), 'avif', 50);
      const alsoPending = compressModernImageInWorker(sourceBlob([2]), 'jxl', 50);
      await vi.waitFor(() =>
        expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(2)
      );
      const failedWorker = FakeWorker.instances[0];
      const firstRejection = expect(first).rejects.toMatchObject({
        code: 'WORKER_ERROR'
      });
      const pendingRejection = expect(alsoPending).rejects.toMatchObject({
        code: 'WORKER_ERROR'
      });

      failedWorker.emitMessage(response);

      await Promise.all([firstRejection, pendingRejection]);
      expect(failedWorker.terminate).toHaveBeenCalledOnce();
    }
  );

  it('tracks many issued requests in constant space and ignores settled IDs in its range', async () => {
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );
    const NativeSet = globalThis.Set;
    const retainedNumericIds = [];
    vi.stubGlobal(
      'Set',
      class extends NativeSet {
        add(value) {
          if (Number.isSafeInteger(value)) retainedNumericIds.push(value);
          return super.add(value);
        }
      }
    );

    let firstSettledId;
    let lastSettledId;
    for (let index = 0; index < 32; index++) {
      const promise = compressModernImageInWorker(sourceBlob([index]), 'avif', 50);
      await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
      const activeWorker = FakeWorker.instances[0];
      await vi.waitFor(() =>
        expect(activeWorker.postMessage).toHaveBeenCalledTimes(index + 1)
      );
      const request = activeWorker.postMessage.mock.calls[index][0];
      firstSettledId ??= request.id;
      lastSettledId = request.id;
      activeWorker.emitMessage({
        id: request.id,
        ok: true,
        buffer: makeAvif(),
        mimeType: 'image/avif',
        width: 1,
        height: 1
      });
      await promise;
    }

    const worker = FakeWorker.instances[0];
    const pending = compressModernImageInWorker(sourceBlob([2]), 'jxl', 50);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(33));
    const pendingRequest = worker.postMessage.mock.calls[32][0];
    worker.emitMessage({ id: firstSettledId, ok: true });
    worker.emitMessage({ id: lastSettledId, ok: true });
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emitMessage({
      id: pendingRequest.id,
      ok: true,
      buffer: makeJxl(),
      mimeType: 'image/jxl',
      width: 1,
      height: 1
    });

    await expect(pending).resolves.toMatchObject({ width: 1, height: 1 });
    expect(retainedNumericIds).toEqual([]);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('rejects all generation-owned work after a worker error and ignores stale events', async () => {
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );
    const first = compressModernImageInWorker(sourceBlob([1]), 'avif', 35);
    const alsoPending = compressModernImageInWorker(sourceBlob([2]), 'jxl', 75);
    await vi.waitFor(() =>
      expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(2)
    );
    const failedWorker = FakeWorker.instances[0];
    const firstRejection = expect(first).rejects.toMatchObject({
      code: 'WORKER_ERROR'
    });
    const pendingRejection = expect(alsoPending).rejects.toMatchObject({
      code: 'WORKER_ERROR'
    });

    failedWorker.emitError('private crash detail');
    await Promise.all([firstRejection, pendingRejection]);
    expect(failedWorker.terminate).toHaveBeenCalledOnce();

    const retry = compressModernImageInWorker(sourceBlob([3]), 'avif', 50);
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const replacement = FakeWorker.instances[1];
    const request = replacement.postMessage.mock.calls[0][0];
    let retryError;
    const guardedRetry = retry.catch(error => {
      retryError = error;
      return null;
    });

    failedWorker.emitError('queued stale crash');
    failedWorker.emitMessage({
      id: request.id,
      ok: false,
      code: 'ENCODE_ERROR'
    });
    expect(replacement.terminate).not.toHaveBeenCalled();

    replacement.emitMessage({
      id: request.id,
      ok: true,
      buffer: makeAvif(),
      mimeType: 'image/avif',
      width: 1,
      height: 1
    });

    expect(await guardedRetry).toMatchObject({ width: 1, height: 1 });
    expect(retryError).toBeUndefined();
  });

  it('times out every request owned by a generation, terminates it, and recovers', async () => {
    vi.useFakeTimers();
    const {
      MODERN_IMAGE_WORKER_TIMEOUT_MS,
      compressModernImageInWorker
    } = await import('./modernImageCompressionWorker');
    const first = compressModernImageInWorker(sourceBlob([1]), 'avif', 35);
    const alsoPending = compressModernImageInWorker(sourceBlob([2]), 'jxl', 75);
    await vi.advanceTimersByTimeAsync(0);
    const timedOutWorker = FakeWorker.instances[0];
    const firstRejection = expect(first).rejects.toMatchObject({
      code: 'WORKER_TIMEOUT'
    });
    const pendingRejection = expect(alsoPending).rejects.toMatchObject({
      code: 'WORKER_TIMEOUT'
    });

    await vi.advanceTimersByTimeAsync(MODERN_IMAGE_WORKER_TIMEOUT_MS);
    await Promise.all([firstRejection, pendingRejection]);
    expect(timedOutWorker.terminate).toHaveBeenCalledOnce();

    const retry = compressModernImageInWorker(sourceBlob([3]), 'jxl', 50);
    await vi.advanceTimersByTimeAsync(0);
    const replacement = FakeWorker.instances[1];
    const request = replacement.postMessage.mock.calls[0][0];
    timedOutWorker.emitError('queued stale timeout crash');
    expect(replacement.terminate).not.toHaveBeenCalled();
    replacement.emitMessage({
      id: request.id,
      ok: true,
      buffer: makeJxl(),
      mimeType: 'image/jxl',
      width: 1,
      height: 1
    });

    await expect(retry).resolves.toMatchObject({ width: 1, height: 1 });
  });

  it('clears request timers after success and structured failure', async () => {
    vi.useFakeTimers();
    const {
      MODERN_IMAGE_WORKER_TIMEOUT_MS,
      compressModernImageInWorker
    } = await import('./modernImageCompressionWorker');
    const success = compressModernImageInWorker(sourceBlob([1]), 'avif', 35);
    await vi.advanceTimersByTimeAsync(0);
    const worker = FakeWorker.instances[0];
    const successRequest = worker.postMessage.mock.calls[0][0];
    worker.emitMessage({
      id: successRequest.id,
      ok: true,
      buffer: makeAvif(),
      mimeType: 'image/avif',
      width: 1,
      height: 1
    });
    await success;

    const failure = compressModernImageInWorker(sourceBlob([2]), 'jxl', 50);
    await vi.advanceTimersByTimeAsync(0);
    const failureRequest = worker.postMessage.mock.calls[1][0];
    worker.emitMessage({
      id: failureRequest.id,
      ok: false,
      code: 'ENCODE_ERROR'
    });
    await expect(failure).rejects.toMatchObject({ code: 'ENCODE_ERROR' });

    await vi.advanceTimersByTimeAsync(MODERN_IMAGE_WORKER_TIMEOUT_MS);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('keeps listener setup atomic and replaces a partially configured worker', async () => {
    let listenerAttempts = 0;
    class ListenerThrowWorker extends FakeWorker {
      addEventListener(type, listener) {
        listenerAttempts++;
        if (listenerAttempts === 2) throw new Error('private listener detail');
        super.addEventListener(type, listener);
      }
    }
    vi.stubGlobal('Worker', ListenerThrowWorker);
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );

    const error = await compressModernImageInWorker(
      sourceBlob([1]),
      'avif',
      35
    ).catch(value => value);
    expect(error).toMatchObject({ code: 'WORKER_ERROR' });
    expect(error.message).not.toContain('private listener detail');
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();

    const retry = compressModernImageInWorker(sourceBlob([2]), 'jxl', 50);
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const replacement = FakeWorker.instances[1];
    const request = replacement.postMessage.mock.calls[0][0];
    replacement.emitMessage({
      id: request.id,
      ok: true,
      buffer: makeJxl(),
      mimeType: 'image/jxl',
      width: 1,
      height: 1
    });

    await expect(retry).resolves.toMatchObject({ width: 1, height: 1 });
  });

  it('rejects pending work after a synchronous postMessage failure', async () => {
    class PostMessageThrowWorker extends FakeWorker {
      postMessage = vi.fn(() => {
        throw new Error('private clone detail');
      });
    }
    vi.stubGlobal('Worker', PostMessageThrowWorker);
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );

    const error = await compressModernImageInWorker(
      sourceBlob([1]),
      'avif',
      35
    ).catch(value => value);
    expect(error).toMatchObject({ code: 'WORKER_ERROR' });
    expect(error.message).not.toContain('private clone detail');
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it('rejects unsupported formats before creating a worker', async () => {
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );

    await expect(
      compressModernImageInWorker(sourceBlob([1]), 'webp', 50)
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it.each(['constructor', '__proto__'])(
    'rejects inherited-property format %s before reading the source or creating a worker',
    async format => {
      const source = fakeSource();
      const { compressModernImageInWorker } = await import(
        './modernImageCompressionWorker'
      );

      await expect(
        compressModernImageInWorker(source, format, 50)
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
      expect(source.arrayBuffer).not.toHaveBeenCalled();
      expect(FakeWorker.instances).toHaveLength(0);
    }
  );

  it('rejects when Web Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const { compressModernImageInWorker } = await import(
      './modernImageCompressionWorker'
    );

    await expect(
      compressModernImageInWorker(sourceBlob([1]), 'avif', 50)
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_BROWSER' });
    expect(FakeWorker.instances).toHaveLength(0);
  });
});
