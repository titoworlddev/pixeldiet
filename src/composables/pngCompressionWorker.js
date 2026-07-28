let worker = null;
let nextRequestId = 0;
const pendingRequests = new Map();
export const PNG_WORKER_TIMEOUT_MS = 5 * 60_000;

const createError = (code, message) =>
  Object.assign(new Error(message), { code });

const rejectPendingAndResetWorker = (error, failedWorker) => {
  if (!failedWorker || worker !== failedWorker) return;
  worker = null;
  pendingRequests.forEach((pending, id) => {
    if (pending.worker !== failedWorker) return;
    const { reject, timeoutId } = pending;
    clearTimeout(timeoutId);
    reject(error);
    pendingRequests.delete(id);
  });
  failedWorker.terminate();
};

const handleMessage = (event, sourceWorker) => {
  if (worker !== sourceWorker) return;
  const { id, ok, error, buffer, ...metadata } = event.data;
  const pending = pendingRequests.get(id);
  if (!pending || pending.worker !== sourceWorker) return;

  if (!ok) {
    const requestError = createError(error.code, error.message);
    if (error.code === 'CODEC_LOAD_ERROR') {
      rejectPendingAndResetWorker(requestError, sourceWorker);
      return;
    }

    pendingRequests.delete(id);
    clearTimeout(pending.timeoutId);
    pending.reject(requestError);
    return;
  }

  pendingRequests.delete(id);
  clearTimeout(pending.timeoutId);
  pending.resolve({
    blob: new Blob([buffer], { type: 'image/png' }),
    ...metadata
  });
};

const handleWorkerError = (event, sourceWorker) => {
  if (worker !== sourceWorker) return;
  const error = createError(
    'WORKER_ERROR',
    event.message || 'Error en el worker de compresión PNG'
  );
  rejectPendingAndResetWorker(error, sourceWorker);
};

const getWorker = () => {
  if (!worker) {
    const createdWorker = new Worker(
      new URL('../workers/pngCompression.worker.js', import.meta.url),
      { type: 'module' }
    );
    try {
      createdWorker.addEventListener('message', event =>
        handleMessage(event, createdWorker)
      );
      createdWorker.addEventListener('error', event =>
        handleWorkerError(event, createdWorker)
      );
    } catch (error) {
      createdWorker.terminate();
      throw error;
    }
    worker = createdWorker;
  }
  return worker;
};

export async function compressPngInWorker(blob) {
  if (typeof Worker === 'undefined') {
    throw createError('UNSUPPORTED_BROWSER', 'Web Workers no disponibles');
  }

  const buffer = await blob.arrayBuffer();
  const id = ++nextRequestId;
  return new Promise((resolve, reject) => {
    let requestWorker;
    try {
      requestWorker = getWorker();
    } catch (error) {
      reject(
        createError(
          'WORKER_ERROR',
          error?.message || 'No se pudo iniciar el worker de compresión PNG'
        )
      );
      return;
    }

    const timeoutId = setTimeout(() => {
      if (pendingRequests.get(id)?.worker !== requestWorker) return;
      rejectPendingAndResetWorker(
        createError('WORKER_TIMEOUT', 'La compresión PNG tardó demasiado'),
        requestWorker
      );
    }, PNG_WORKER_TIMEOUT_MS);
    pendingRequests.set(id, {
      resolve,
      reject,
      timeoutId,
      worker: requestWorker
    });
    try {
      requestWorker.postMessage({ id, buffer, mimeType: blob.type }, [buffer]);
    } catch (error) {
      rejectPendingAndResetWorker(
        createError(
          'WORKER_ERROR',
          error?.message || 'No se pudo iniciar el worker de compresión PNG'
        ),
        requestWorker
      );
    }
  });
}
