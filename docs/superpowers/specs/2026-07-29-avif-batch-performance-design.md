# AVIF And Batch Performance Design

## Goal

Make AVIF practical for multi-image batches while preserving strong compression,
real AVIF/JXL output, bounded memory, and a coherent all-at-once batch update.

## Measured Baseline

Using `test_images/Original.png` at quality 75 in a warm Chromium codec:

| Codec setting | Time | Output |
| --- | ---: | ---: |
| AVIF speed 4 | 4,436 ms average | 40,778 bytes |
| AVIF speed 6 | 619 ms average | 41,746 bytes |
| AVIF speed 8 | 171 ms average | 69,331 bytes |
| JXL effort 7 | 371 ms | 30,041 bytes |

AVIF speed 6 is the selected tradeoff: approximately seven times faster than
speed 4 for only 968 additional bytes (2.4%) on the approved fixture. Speed 8
is rejected because its 70% size increase undermines compression.

## Encoding Policy

- Change only AVIF encoder speed from 4 to 6.
- Keep AVIF quality, alpha quality, bit depth, and lossless settings unchanged.
- Keep JPEG XL effort 7 and all PNG/JPEG/WebP algorithms unchanged.
- Preserve all existing signature, MIME, quality, pixel-limit, and worker-output
  validation.

## Worker Pool

- Modern AVIF/JXL encoding uses a persistent pool capped at two workers.
- Devices reporting fewer than four logical processors use one worker.
- Missing hardware-concurrency information defaults to one worker.
- A second worker is created only when the first already owns active work.
- Requests go to the least-loaded healthy worker.
- A timeout or fatal failure removes only its owner, rejects only its requests,
  and permits a replacement; the other worker continues.
- Settled workers remain warm for later batches.

## Batch Processing

- AVIF/JXL batch concurrency matches the modern worker pool size: one or two.
- JPEG/WebP and other native lossy formats use concurrency four.
- PNG remains concurrency one because its existing worker/profile is already
  intentionally serialized.
- Compression results are collected first and applied to reactive image cards
  together after the whole batch settles.
- Cached images remain skipped, settings are snapshotted once, and one image
  failure does not prevent other results from being applied.
- Existing aggregate success, unchanged, and failure notifications remain.

## Verification

- Unit tests prove exact AVIF speed 6 options.
- Worker tests prove pool sizing, lazy second-worker creation, least-loaded
  assignment, per-owner failure isolation, timeout recovery, and no leaks.
- Batch policy tests prove concurrency 1/2/4, no over-limit execution, atomic
  card updates, cache skipping, settings snapshots, and failure continuation.
- Browser benchmarks compare one and three fixture images before/after using
  the development application, confirm real signatures, and inspect main-thread
  responsiveness, worker count, requests, and memory behavior.
- Full tests, production build, and `git diff --check` must pass.
