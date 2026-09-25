import { pipeline } from "@huggingface/transformers";

const detector = await pipeline(
  "object-detection",
  "Xenova/yolos-tiny"
);

const image =
  "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/cats.jpg";

const output = await detector(image, {
  threshold: 0.9,
});

console.log(output);