import { OEM, PSM, type RecognizeResult } from "tesseract.js";

export interface PageOcrWorker {
  readonly stopped: boolean;
  recognize(image: Uint8Array): Promise<RecognizeResult>;
}

/** Own the native worker before initialization: Tesseract 7's createWorker hides it until initialization succeeds. */
export async function startOcrWorker(base: string, languages: string[], cachePath: string, signal: AbortSignal): Promise<PageOcrWorker> {
  signal.throwIfAborted();
  const path = new URL(base, window.location.href).href;
  const worker = new Worker(`${path}/worker.min.js`);
  const jobs = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  let nextJob = 0;
  let stopped = false;

  function stop(error: unknown) {
    if (stopped) return;
    stopped = true;
    signal.removeEventListener("abort", abort);
    worker.terminate();
    for (const job of jobs.values()) job.reject(error);
    jobs.clear();
  }
  const abort = () => stop(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  worker.onerror = event => stop(new Error(event.message || "OCR worker failed."));
  worker.onmessageerror = () => stop(new Error("Couldn't read the OCR worker response."));
  worker.onmessage = ({ data: { jobId, status, data } }) => {
    const job = jobs.get(jobId);
    if (!job || status === "progress") return;
    jobs.delete(jobId);
    if (status === "reject") job.reject(new Error(String(data)));
    else job.resolve({ jobId, data });
  };

  function request<T = unknown>(action: string, payload: object): Promise<T> {
    signal.throwIfAborted();
    if (stopped) return Promise.reject(new Error("OCR worker stopped."));
    return new Promise((resolve, reject) => {
      const jobId = String(++nextJob);
      jobs.set(jobId, { resolve: value => resolve(value as T), reject });
      try {
        worker.postMessage({ workerId: "doko", jobId, action, payload });
      } catch (error) {
        stop(error);
      }
    });
  }

  const timeout = setTimeout(() => stop(new Error("OCR initialization timed out.")), 60_000);
  try {
    await request("load", { options: { lstmOnly: true, corePath: path, logging: false } });
    await request("loadLanguage", { langs: languages, options: { langPath: path, cachePath, cacheMethod: "readOnly", gzip: true, lstmOnly: true } });
    await request("initialize", { langs: languages, oem: OEM.LSTM_ONLY, config: {} });
    await request("setParameters", { params: { tessedit_pageseg_mode: PSM.AUTO } });
    return { get stopped() { return stopped; }, recognize: image => request<RecognizeResult>("recognize", { image, options: {}, output: { blocks: true, text: false } }) };
  } catch (error) {
    stop(error);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
