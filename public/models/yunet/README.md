# YuNet model

Place the YuNet ONNX model here with this exact filename:

`face_detection_yunet_2023mar.onnx`

The provided project contained the detector code but not the ONNX weights:
the vision-model `.gitignore` excludes its `models/` directory.

Expected extension path:

`public/models/yunet/face_detection_yunet_2023mar.onnx`

Vite copies `public/` into the extension build unchanged. Inference is local
inside the extension once the model is present.
