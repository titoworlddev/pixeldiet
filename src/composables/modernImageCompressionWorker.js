import { hasModernImageSignature } from '../utils/modernImageCompression';

const MIME_TYPES = new Map([
  ['avif', 'image/avif'],
  ['jxl', 'image/jxl']
]);

const ERROR_MESSAGES = {
  UNSUPPORTED_BROWSER: 'Tu navegador no admite esta compresión',
  IMAGE_TOO_LARGE: 'La imagen es demasiado grande',
  INVALID_IMAGE: 'No se pudo leer la imagen',
  UNSUPPORTED_FORMAT: 'Formato no compatible',
  INVALID_QUALITY: 'Calidad no válida',
  CODEC_LOAD_ERROR: 'No se pudo cargar el compresor',
  ENCODE_ERROR: 'No se pudo comprimir la imagen',
  WORKER_ERROR: 'Error en el worker de compresión',
  WORKER_TIMEOUT: 'La compresión tardó demasiado'
};

const WORKER_RESPONSE_CODES = new Set([
  'UNSUPPORTED_BROWSER',
  'IMAGE_TOO_LARGE',
  'INVALID_IMAGE',
  'UNSUPPORTED_FORMAT',
  'INVALID_QUALITY',
  'CODEC_LOAD_ERROR',
  'ENCODE_ERROR'
]);

let nextGeneration = 0;
const workerOwners = [];

export const MODERN_IMAGE_WORKER_TIMEOUT_MS = 5 * 60_000;

export const getModernImageWorkerPoolCapacity = hardwareConcurrency =>
  Number.isSafeInteger(hardwareConcurrency) && hardwareConcurrency >= 4 ? 2 : 1;

export const MODERN_IMAGE_WORKER_POOL_CAPACITY = getModernImageWorkerPoolCapacity(
  globalThis.navigator?.hardwareConcurrency
);

const createError = code =>
  Object.assign(new Error(ERROR_MESSAGES[code] || ERROR_MESSAGES.WORKER_ERROR), {
    code
  });

const ownsRequest = (pending, owner) =>
  pending?.owner === owner && pending.generation === owner.generation;

const isHealthyOwner = owner =>
  owner.healthy && workerOwners.includes(owner);

const wasIssuedToOwner = (id, owner) =>
  owner.firstIssuedRequestId !== null &&
  id >= owner.firstIssuedRequestId &&
  id <= owner.lastIssuedRequestId;

const settleRequest = (id, pending, settle, value) => {
  pending.owner.pendingRequests.delete(id);
  pending.owner.activeRequestCount--;
  clearTimeout(pending.timeoutId);
  settle(value);
};

const rejectOwnerAndRemove = (error, owner) => {
  if (!isHealthyOwner(owner)) return;
  owner.healthy = false;
  workerOwners.splice(workerOwners.indexOf(owner), 1);
  owner.pendingRequests.forEach((pending, id) => {
    if (!ownsRequest(pending, owner)) return;
    owner.pendingRequests.delete(id);
    clearTimeout(pending.timeoutId);
    pending.reject(error);
  });
  owner.activeRequestCount = 0;
  owner.worker.terminate();
};

const invalidWorkerOutput = owner => {
  rejectOwnerAndRemove(createError('ENCODE_ERROR'), owner);
};

const handleMessage = (event, owner) => {
  if (!isHealthyOwner(owner)) return;

  const response = event?.data;
  if (!response || typeof response !== 'object') {
    rejectOwnerAndRemove(createError('WORKER_ERROR'), owner);
    return;
  }

  if (
    !Object.hasOwn(response, 'id') ||
    !Number.isSafeInteger(response.id) ||
    response.id <= 0
  ) {
    rejectOwnerAndRemove(createError('WORKER_ERROR'), owner);
    return;
  }

  const pending = owner.pendingRequests.get(response.id);
  if (!pending) {
    if (wasIssuedToOwner(response.id, owner)) return;
    rejectOwnerAndRemove(createError('WORKER_ERROR'), owner);
    return;
  }
  if (!ownsRequest(pending, owner)) {
    rejectOwnerAndRemove(createError('WORKER_ERROR'), owner);
    return;
  }

  if (response.ok === false) {
    if (!WORKER_RESPONSE_CODES.has(response.code)) {
      rejectOwnerAndRemove(createError('WORKER_ERROR'), owner);
      return;
    }
    const error = createError(response.code);
    if (response.code === 'CODEC_LOAD_ERROR') {
      rejectOwnerAndRemove(error, owner);
      return;
    }
    settleRequest(response.id, pending, pending.reject, error);
    return;
  }

  if (
    response.ok !== true ||
    !(response.buffer instanceof ArrayBuffer) ||
    response.mimeType !== pending.mimeType ||
    !Number.isSafeInteger(response.width) ||
    response.width <= 0 ||
    !Number.isSafeInteger(response.height) ||
    response.height <= 0 ||
    !hasModernImageSignature(response.buffer, pending.format)
  ) {
    invalidWorkerOutput(owner);
    return;
  }

  let blob;
  try {
    blob = new Blob([response.buffer], { type: response.mimeType });
  } catch {
    settleRequest(
      response.id,
      pending,
      pending.reject,
      createError('ENCODE_ERROR')
    );
    return;
  }

  settleRequest(response.id, pending, pending.resolve, {
    blob,
    width: response.width,
    height: response.height
  });
};

const handleWorkerError = (_event, owner) => {
  if (!isHealthyOwner(owner)) return;
  rejectOwnerAndRemove(createError('WORKER_ERROR'), owner);
};

const createWorkerOwner = () => {
  const createdWorker = new Worker(
    new URL('../workers/modernImageCompression.worker.js', import.meta.url),
    { type: 'module' }
  );
  const owner = {
    worker: createdWorker,
    generation: ++nextGeneration,
    healthy: false,
    activeRequestCount: 0,
    pendingRequests: new Map(),
    nextRequestId: 0,
    firstIssuedRequestId: null,
    lastIssuedRequestId: null
  };

  try {
    createdWorker.addEventListener('message', event =>
      handleMessage(event, owner)
    );
    createdWorker.addEventListener('error', event =>
      handleWorkerError(event, owner)
    );
  } catch {
    createdWorker.terminate();
    throw createError('WORKER_ERROR');
  }

  owner.healthy = true;
  workerOwners.push(owner);
  return owner;
};

const getWorkerOwner = () => {
  if (workerOwners.length === 0) return createWorkerOwner();

  const leastLoadedOwner = workerOwners.reduce((leastLoaded, owner) =>
    owner.activeRequestCount < leastLoaded.activeRequestCount
      ? owner
      : leastLoaded
  );
  if (
    workerOwners.length < MODERN_IMAGE_WORKER_POOL_CAPACITY &&
    leastLoadedOwner.activeRequestCount > 0
  ) {
    return createWorkerOwner();
  }
  return leastLoadedOwner;
};

export async function compressModernImageInWorker(blob, format, quality) {
  const outputMimeType = MIME_TYPES.get(format);
  if (!outputMimeType) throw createError('UNSUPPORTED_FORMAT');
  if (typeof Worker === 'undefined') throw createError('UNSUPPORTED_BROWSER');

  let buffer;
  try {
    buffer = await blob.arrayBuffer();
  } catch {
    throw createError('INVALID_IMAGE');
  }

  return new Promise((resolve, reject) => {
    let owner;
    try {
      owner = getWorkerOwner();
    } catch {
      reject(createError('WORKER_ERROR'));
      return;
    }

    const id = ++owner.nextRequestId;
    const timeoutId = setTimeout(() => {
      const pending = owner.pendingRequests.get(id);
      if (!ownsRequest(pending, owner)) return;
      rejectOwnerAndRemove(createError('WORKER_TIMEOUT'), owner);
    }, MODERN_IMAGE_WORKER_TIMEOUT_MS);

    owner.pendingRequests.set(id, {
      resolve,
      reject,
      timeoutId,
      owner,
      generation: owner.generation,
      format,
      mimeType: outputMimeType
    });
    owner.activeRequestCount++;
    owner.firstIssuedRequestId ??= id;
    owner.lastIssuedRequestId = id;

    try {
      owner.worker.postMessage(
        { id, buffer, mimeType: blob.type, format, quality },
        [buffer]
      );
    } catch {
      rejectOwnerAndRemove(createError('WORKER_ERROR'), owner);
    }
  });
}
