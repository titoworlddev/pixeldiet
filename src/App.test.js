import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from '@vue/server-renderer';

const {
  compressImageMock,
  downloadAllImagesMock,
  downloadSingleImageMock,
  modernPoolCapacity,
  toastAddMock
} = vi.hoisted(() => ({
  compressImageMock: vi.fn(),
  downloadAllImagesMock: vi.fn(),
  downloadSingleImageMock: vi.fn(),
  modernPoolCapacity: { value: 2 },
  toastAddMock: vi.fn()
}));

vi.mock('./composables/useImageProcessor', () => ({
  useImageProcessor: () => ({
    compressImage: compressImageMock,
    downloadAllImages: downloadAllImagesMock,
    downloadSingleImage: downloadSingleImageMock
  })
}));

vi.mock('./composables/modernImageCompressionWorker', () => ({
  get MODERN_IMAGE_WORKER_POOL_CAPACITY() {
    return modernPoolCapacity.value;
  }
}));

vi.mock('primevue/usetoast', () => ({
  useToast: () => ({ add: toastAddMock })
}));

vi.mock('primevue/toast', () => ({ default: () => null }));
vi.mock('primevue/progressbar', () => ({ default: () => null }));
vi.mock('primevue/badge', () => ({
  default: props => h('span', { class: 'p-badge' }, props.value)
}));
vi.mock('primevue/button', () => ({
  default: props =>
    h(
      'button',
      {
        'data-disabled': String(Boolean(props.disabled)),
        'data-icon': props.icon,
        'data-label': props.label,
        disabled: props.disabled
      },
      props.label || ''
    )
}));
vi.mock('primevue/fileupload', () => ({
  default: props =>
    h('input', {
      'data-component': 'file-upload',
      'data-disabled': String(Boolean(props.disabled)),
      disabled: props.disabled,
      type: 'file'
    })
}));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const image = id => ({
  id,
  name: `${id}.png`,
  originalSize: 20_001,
  type: 'image/png',
  src: 'data:image/png;base64,iVBORw0KGgo=',
  isCompressed: false
});

const compressionResult = id => ({
  compressedSize: id.charCodeAt(0),
  compressedSrc: `data:image/avif;base64,${id}`,
  compressedPreviewSrc: undefined,
  compressedType: 'image/avif',
  compressionStatus: 'optimized',
  compressionNotice: null,
  compressionDetails: null,
  compressedQuality: 75,
  compressionProfile: null
});

const trackedCard = (id, writes) => {
  const card = image(id);
  const fields = [
    'isCompressed',
    'compressedSize',
    'compressedSrc',
    'compressedPreviewSrc',
    'compressedType',
    'compressionStatus',
    'compressionNotice',
    'compressionDetails',
    'compressedQuality',
    'compressionProfile'
  ];
  const values = Object.fromEntries(fields.map(field => [field, card[field]]));
  fields.forEach(field => {
    Object.defineProperty(card, field, {
      configurable: true,
      enumerable: true,
      get: () => values[field],
      set: value => {
        writes.push(`${id}.${field}`);
        values[field] = value;
      }
    });
  });
  return card;
};

const createCompressionController = () => {
  const jobs = [];
  const startWaiters = [];
  let active = 0;
  let maxActive = 0;

  compressImageMock.mockImplementation((card, format, quality) => {
    const work = deferred();
    const settled = deferred();
    const job = { card, format, quality, settled, ...work };
    jobs.push(job);
    active++;
    maxActive = Math.max(maxActive, active);
    startWaiters.splice(0).forEach(waiter => waiter());
    return work.promise.finally(() => {
      active--;
      settled.resolve();
    });
  });

  return {
    jobs,
    get active() {
      return active;
    },
    get maxActive() {
      return maxActive;
    },
    waitForStarts(count) {
      if (jobs.length >= count) return Promise.resolve();
      return new Promise(resolve => {
        const check = () => {
          if (jobs.length >= count) resolve();
          else startWaiters.push(check);
        };
        startWaiters.push(check);
      });
    }
  };
};

const renderApp = async (App, options = {}) => {
  const originalSetup = App.setup;
  let bindings;
  App.setup = (props, context) => {
    bindings = originalSetup(props, context);
    bindings.images.value = options.images || [];
    bindings.selectedFormat.value = options.format || 'image/avif';
    bindings.compressionQuality.value = options.quality || 75;
    bindings.isProcessing.value = options.isProcessing || false;
    bindings.isUploading.value = options.isUploading || false;
    return bindings;
  };
  let html;
  try {
    const app = createSSRApp(App);
    app.directive('tooltip', { getSSRProps: () => ({}) });
    html = await renderToString(app);
  } finally {
    App.setup = originalSetup;
  }
  return { bindings, html };
};

const expectedWrites = ids => {
  const fields = [
    'isCompressed',
    'compressedSize',
    'compressedSrc',
    'compressedPreviewSrc',
    'compressedType',
    'compressionStatus',
    'compressionNotice',
    'compressionDetails',
    'compressedQuality',
    'compressionProfile'
  ];
  return ids.flatMap(id => fields.map(field => `${id}.${field}`));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App batch orchestration', () => {
  beforeEach(() => {
    compressImageMock.mockReset();
    downloadAllImagesMock.mockReset();
    downloadSingleImageMock.mockReset();
    toastAddMock.mockReset();
    modernPoolCapacity.value = 2;
  });

  it('settles direct mapper rejection, keeps scheduling at cap, and applies fulfilled cards atomically in input order', async () => {
    const { default: App } = await import('./App.vue?direct-rejection');
    const writes = [];
    const cards = ['a', 'b', 'c', 'd', 'e'].map(id => trackedCard(id, writes));
    const controller = createCompressionController();
    const { bindings } = await renderApp(App, { images: cards });

    const batch = bindings.handleCompressAll();
    await controller.waitForStarts(2);
    expect(controller.active).toBe(2);
    expect(controller.maxActive).toBe(2);
    expect(writes).toEqual([]);

    controller.jobs[1].reject(new Error('direct compression rejection'));
    await controller.waitForStarts(3);
    controller.jobs[2].resolve(compressionResult('c'));
    await controller.waitForStarts(4);
    controller.jobs[3].resolve(compressionResult('d'));
    await controller.waitForStarts(5);

    expect(controller.maxActive).toBe(2);
    expect(writes).toEqual([]);
    await bindings.handleCompressAll();
    expect(controller.jobs).toHaveLength(5);

    controller.jobs[4].resolve(compressionResult('e'));
    await Promise.all([
      controller.jobs[1].settled.promise,
      controller.jobs[2].settled.promise,
      controller.jobs[3].settled.promise,
      controller.jobs[4].settled.promise
    ]);

    expect(bindings.isProcessing.value).toBe(true);
    expect(writes).toEqual([]);
    controller.jobs[0].resolve(compressionResult('a'));
    await batch;

    expect(writes).toEqual(expectedWrites(['a', 'c', 'd', 'e']));
    expect(cards[0]).toMatchObject({ isCompressed: true, compressedSize: 97 });
    expect(cards[1]).toMatchObject({ isCompressed: false });
    expect(cards[2]).toMatchObject({ isCompressed: true, compressedSize: 99 });
    expect(cards[3]).toMatchObject({ isCompressed: true, compressedSize: 100 });
    expect(cards[4]).toMatchObject({ isCompressed: true, compressedSize: 101 });
    expect(bindings.isProcessing.value).toBe(false);
    expect(toastAddMock.mock.calls.map(([notification]) => notification)).toEqual([
      {
        severity: 'success',
        summary: 'Compresión completada',
        detail: '4 imágenes comprimidas correctamente',
        life: 3000
      },
      {
        severity: 'error',
        summary: 'Algunas imágenes no se procesaron',
        detail: '1 imágenes no se pudieron comprimir',
        life: 4000
      }
    ]);
  });

  it('uses one active modern slot for the low-CPU runtime capacity', async () => {
    modernPoolCapacity.value = 1;
    const { default: App } = await import('./App.vue?low-cpu-concurrency');
    const cards = ['a', 'b', 'c'].map(image);
    const controller = createCompressionController();
    const { bindings } = await renderApp(App, { images: cards });

    const batch = bindings.handleCompressAll();
    await controller.waitForStarts(1);
    expect(controller.jobs).toHaveLength(1);
    controller.jobs[0].resolve(compressionResult('a'));
    await controller.waitForStarts(2);
    expect(controller.maxActive).toBe(1);
    controller.jobs[1].resolve(compressionResult('b'));
    await controller.waitForStarts(3);
    expect(controller.maxActive).toBe(1);
    controller.jobs[2].resolve(compressionResult('c'));
    await batch;

    expect(controller.maxActive).toBe(1);
  });

  it('uses four active slots for native lossy batches and continues at the cap', async () => {
    const { default: App } = await import('./App.vue?native-concurrency');
    const cards = ['a', 'b', 'c', 'd', 'e', 'f'].map(image);
    const controller = createCompressionController();
    const { bindings } = await renderApp(App, {
      format: 'image/webp',
      images: cards
    });

    const batch = bindings.handleCompressAll();
    await controller.waitForStarts(4);
    expect(controller.jobs).toHaveLength(4);
    expect(controller.active).toBe(4);
    controller.jobs[2].resolve(compressionResult('c'));
    await controller.waitForStarts(5);
    expect(controller.maxActive).toBe(4);
    controller.jobs[0].resolve(compressionResult('a'));
    await controller.waitForStarts(6);
    expect(controller.maxActive).toBe(4);
    [1, 3, 4, 5].forEach(index => {
      controller.jobs[index].resolve(compressionResult(cards[index].id));
    });
    await batch;

    expect(controller.maxActive).toBe(4);
  });
});

describe('App processing guards', () => {
  beforeEach(() => {
    compressImageMock.mockReset();
    toastAddMock.mockReset();
  });

  it('ignores upload, drop, clear, and remove handlers while processing', async () => {
    const { default: App } = await import('./App.vue?processing-handler-guards');
    const cards = [image('kept')];
    const { bindings } = await renderApp(App, {
      images: cards,
      isProcessing: true
    });
    const file = { name: 'new.png', size: 100, type: 'image/png' };
    const classList = { remove: vi.fn() };
    const dropEvent = {
      currentTarget: { classList },
      dataTransfer: { files: [file] },
      preventDefault: vi.fn()
    };
    const inputClick = vi.fn();
    bindings.fileUploadRef.value = {
      clear: vi.fn(),
      $el: { querySelector: vi.fn(() => ({ click: inputClick })) }
    };

    bindings.handleFileUpload({ files: [file] });
    bindings.onDrop(dropEvent);
    bindings.openFilePicker();
    bindings.clearAll();
    bindings.removeImage('kept');

    expect(bindings.images.value).toHaveLength(1);
    expect(bindings.images.value[0].id).toBe('kept');
    expect(bindings.isUploading.value).toBe(false);
    expect(dropEvent.preventDefault).toHaveBeenCalledOnce();
    expect(inputClick).not.toHaveBeenCalled();
    expect(toastAddMock).not.toHaveBeenCalled();

    bindings.isProcessing.value = false;
    bindings.openFilePicker();
    expect(inputClick).toHaveBeenCalledOnce();
  });

  it('does not start compression while a FileReader upload is pending', async () => {
    const readers = [];
    class DeferredFileReader {
      readAsDataURL() {
        readers.push(this);
      }
    }
    vi.stubGlobal('FileReader', DeferredFileReader);
    compressImageMock.mockResolvedValue(compressionResult('a'));
    const { default: App } = await import('./App.vue?pending-upload-guard');
    const { bindings } = await renderApp(App, { images: [image('a')] });
    const file = { name: 'new.png', size: 100, type: 'image/png' };
    const secondFile = { name: 'second.png', size: 100, type: 'image/png' };
    const inputClick = vi.fn();
    bindings.fileUploadRef.value = {
      clear: vi.fn(),
      $el: { querySelector: vi.fn(() => ({ click: inputClick })) }
    };
    const dropEvent = {
      currentTarget: { classList: { remove: vi.fn() } },
      dataTransfer: { files: [secondFile] },
      preventDefault: vi.fn()
    };

    bindings.handleFileUpload({ files: [file] });
    expect(bindings.isUploading.value).toBe(true);
    expect(readers).toHaveLength(1);

    bindings.handleFileUpload({ files: [secondFile] });
    bindings.onDrop(dropEvent);
    bindings.openFilePicker();
    expect(readers).toHaveLength(1);
    expect(inputClick).not.toHaveBeenCalled();

    await bindings.handleCompressAll();

    expect(compressImageMock).not.toHaveBeenCalled();
    expect(bindings.isProcessing.value).toBe(false);

    readers[0].onload({
      target: { result: 'data:image/png;base64,iVBORw0KGgo=' }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(bindings.isUploading.value).toBe(false);
    expect(bindings.images.value).toHaveLength(2);
  });

  it('renders upload and compression controls disabled while uploading', async () => {
    const { default: App } = await import('./App.vue?uploading-template-guards');
    const { html } = await renderApp(App, {
      images: [image('kept')],
      isUploading: true
    });

    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('data-component="file-upload" data-disabled="true"');
    expect(html).toMatch(
      /data-disabled="true"[^>]*data-label="Comprimir todas las imágenes"|data-label="Comprimir todas las imágenes"[^>]*data-disabled="true"/
    );
    expect(html).toMatch(
      /data-disabled="true"[^>]*data-label="Limpiar todo"|data-label="Limpiar todo"[^>]*data-disabled="true"/
    );
  });

  it('renders upload, clear, and both remove controls disabled while processing', async () => {
    const { default: App } = await import('./App.vue?processing-template-guards');
    const { html } = await renderApp(App, {
      images: [image('kept')],
      isProcessing: true
    });

    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('data-component="file-upload" data-disabled="true"');
    expect(html).toMatch(
      /data-disabled="true"[^>]*data-label="Limpiar todo"|data-label="Limpiar todo"[^>]*data-disabled="true"/
    );
    expect(html.match(/data-icon="pi pi-times"/g)).toHaveLength(2);
    expect(html.match(/data-disabled="true"/g).length).toBeGreaterThanOrEqual(4);
  });
});

describe('App responsive layout', () => {
  it('stacks through tablet and uses equal desktop columns for upload and settings', async () => {
    const { default: App } = await import('./App.vue?responsive-main-layout');
    const { html } = await renderApp(App);

    expect(html).toContain('max-w-4xl lg:max-w-6xl');
    expect(html).toContain(
      'grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch'
    );
    expect(html).toContain('lg:items-stretch" style="display:grid;"');
    expect(html).toContain('lg:mb-0 lg:flex lg:flex-col lg:justify-center');
    expect(html.match(/lg:mb-0/g)).toHaveLength(2);
    expect(html).toContain('format-options-grid gap-2');
  });
});
