import * as ort from "onnxruntime-web";

let session: ort.InferenceSession | null = null;

export async function getYuNetSession(): Promise<ort.InferenceSession> {
    if (session) {
        return session;
    }

    console.log("Loading YuNet...");

    const start = performance.now();

    session = await ort.InferenceSession.create(
        "/models/yunet/face_detection_yunet_2023mar.onnx",
        {
            executionProviders: ["wasm"],
        }
    );

    const loadTime = performance.now() - start;

    console.log(`YuNet loaded in ${loadTime.toFixed(2)} ms`);
    console.log("Input names:", session.inputNames);
    console.log("Output names:", session.outputNames);

    return session;
}