// src/vision/visionEngine.js
//
// Thin adapter around the already-tested YuNet + OpenCV concurrent pipeline.
// This file is the only bridge between the existing privacy engine and the
// vision-model implementation. The detectors run locally in dedicated workers.
//
// YuNet -> face detections
// OpenCV -> card-like quadrilateral candidates
//
// The raw screenshot is passed to the workers only inside this local pipeline.
// Nothing from this module is sent to the LLM directly.

const YUNET_MODEL_PATH = 'models/yunet/face_detection_yunet_2023mar.onnx';

let yunetWorker = null;
let opencvWorker = null;
let nextRequestId = 1;
let initialized = false;
let initializationPromise = null;
let opencvStatus = { state: 'idle', message: 'OpenCV has not been initialized yet.' };
const pendingYuNet = new Map();
const pendingOpenCV = new Map();

function extensionUrl(path) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return `./${path}`;
}

function ensureWorkers() {
  if (yunetWorker && opencvWorker) return;

  yunetWorker = new Worker(
    new URL('./yunet.worker.ts', import.meta.url),
    { type: 'module' },
  );

  opencvWorker = new Worker(
    new URL('./opencv.worker.ts', import.meta.url),
    { type: 'module' },
  );

  yunetWorker.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type === 'ready') {
      return;
    }
    const pending = pendingYuNet.get(message.id);
    if (!pending) return;
    pendingYuNet.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message);
  });

  opencvWorker.addEventListener('message', (event) => {
    const message = event.data || {};
    const pending = pendingOpenCV.get(message.id);
    if (!pending) return;
    pendingOpenCV.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message);
  });

  const workerError = (name) => (event) => {
    console.error(`[Vision] ${name} worker error`, event.error || event.message);
  };

  yunetWorker.addEventListener('error', workerError('YuNet'));
  opencvWorker.addEventListener('error', workerError('OpenCV'));
}

function initialize() {
  if (initialized) return Promise.resolve(status);
  if (initializationPromise) return initializationPromise;

  ensureWorkers();
  status.state = 'loading';
  status.modelUrl = extensionUrl(YUNET_MODEL_PATH);

  initializationPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      status = { state: 'error', message: 'YuNet worker initialization timed out.', modelUrl: status.modelUrl };
      initializationPromise = null;
      reject(new Error(status.message));
    }, 15000);

    const onReady = (event) => {
      if (event.data?.type !== 'ready') return;
      clearTimeout(timeout);
      yunetWorker.removeEventListener('message', onReady);

      if (!event.data.ok) {
        status = {
          state: 'error',
          message: event.data.error || 'YuNet model failed to load.',
          modelUrl: event.data.modelUrl || status.modelUrl,
        };
        initializationPromise = null;
        reject(new Error(status.message));
        return;
      }

      initialized = true;
      status = {
        state: 'ready',
        message: `YuNet loaded in ${(event.data.loadMs || 0).toFixed(0)} ms.`,
        modelUrl: event.data.modelUrl || status.modelUrl,
        loadMs: event.data.loadMs || 0,
      };
      resolve(status);
    };

    yunetWorker.addEventListener('message', onReady);
    yunetWorker.postMessage({
      type: 'init',
      modelUrl: extensionUrl(YUNET_MODEL_PATH),
    });
  });

  return initializationPromise;
}

let status = {
  state: 'idle',
  message: 'Vision model has not been initialized yet.',
  modelUrl: null,
};

function dataUrlToBlob(dataUrl) {
  return fetch(dataUrl).then((response) => {
    if (!response.ok) throw new Error(`Could not read screenshot: HTTP ${response.status}`);
    return response.blob();
  });
}

async function dataUrlToBitmap(dataUrl) {
  const blob = await dataUrlToBlob(dataUrl);
  return createImageBitmap(blob);
}

function runYuNet(image) {
  const id = nextRequestId++;
  const promise = new Promise((resolve, reject) => {
    pendingYuNet.set(id, { resolve, reject });
  });
  yunetWorker.postMessage({ type: 'detect', id, image }, [image]);
  return promise;
}

function runOpenCV(image) {
  const id = nextRequestId++;
  const promise = new Promise((resolve, reject) => {
    pendingOpenCV.set(id, { resolve, reject });
  });
  opencvWorker.postMessage({ id, image }, [image]);
  return promise;
}

function toPrivacyDetection(detection) {
  if (detection.label === 'face') {
    return {
      category: 'face',
      confidence: detection.confidence,
      boundingBox: {
        x: detection.bbox.xmin,
        y: detection.bbox.ymin,
        width: detection.bbox.xmax - detection.bbox.xmin,
        height: detection.bbox.ymax - detection.bbox.ymin,
      },
      sources: ['vision'],
      evidence: 'YuNet face detector',
    };
  }

  return {
    category: 'payment_card',
    confidence: detection.confidence,
    boundingBox: {
      x: detection.bbox.xmin,
      y: detection.bbox.ymin,
      width: detection.bbox.xmax - detection.bbox.xmin,
      height: detection.bbox.ymax - detection.bbox.ymin,
    },
    sources: ['vision'],
    evidence: 'OpenCV card-like quadrilateral detector',
  };
}

async function detectScreenshot(screenshotDataUrl) {
  if (!screenshotDataUrl) {
    throw new Error('Vision scan requires a screenshot.');
  }

  await initialize();

  const [yunetBitmap, opencvBitmap] = await Promise.all([
    dataUrlToBitmap(screenshotDataUrl),
    dataUrlToBitmap(screenshotDataUrl),
  ]);

  const started = performance.now();

  // Important: these two workers are deliberately awaited together.
  opencvStatus = { state: 'loading', message: 'OpenCV worker running.' };
  const [yunetResult, opencvResult] = await Promise.allSettled([
    runYuNet(yunetBitmap),
    runOpenCV(opencvBitmap),
  ]);

  const wallMs = performance.now() - started;

  const yunet = yunetResult.status === 'fulfilled' ? yunetResult.value : null;
  const opencv = opencvResult.status === 'fulfilled' ? opencvResult.value : null;

  if (opencv) {
    opencvStatus = { state: 'ready', message: 'OpenCV card detector completed.' };
  } else {
    opencvStatus = {
      state: 'error',
      message: opencvResult.reason?.message || String(opencvResult.reason || 'OpenCV worker failed.'),
    };
  }

  if (!yunet) {
    const reason = yunetResult.reason?.message || String(yunetResult.reason || 'YuNet worker failed.');
    status = { ...status, state: 'error', message: reason };
  }

  // A failed OpenCV card detector must not throw away a successful YuNet face
  // detection. The two models are intentionally independent privacy signals.
  const detections = [
    ...(yunet?.detections || []).map(toPrivacyDetection),
    ...(opencv?.detections || []).map(toPrivacyDetection),
  ];

  if (!yunet && !opencv) {
    throw new Error(`Vision workers failed. YuNet: ${yunetResult.reason?.message || 'failed'}; OpenCV: ${opencvResult.reason?.message || 'failed'}`);
  }

  return {
    detections,
    visionSummary: {
      faces: yunet?.detections?.length || 0,
      cardCandidates: opencv?.detections?.length || 0,
      wallMs,
      yunetWorkerMs: yunet?.workerMs || 0,
      opencvWorkerMs: opencv?.workerMs || 0,
      yunetLoadMs: yunet?.loadMs || status.loadMs || 0,
      opencvStatus,
    },
  };
}

window.VisionEngine = {
  detectScreenshot,
  getStatus: () => ({ ...status, opencv: { ...opencvStatus } }),
  initialize,
};
