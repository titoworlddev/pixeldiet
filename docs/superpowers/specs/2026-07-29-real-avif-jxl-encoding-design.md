# Real AVIF And JPEG XL Encoding Design

## Goal

Replace the fake AVIF and JPEG XL paths with local browser encoders that emit
valid bytes for the selected format while preserving PixelDiet's strong
compression, visual quality, privacy, and responsive interface.

## Root Cause

`image-resize-compress` supports PNG, WebP, BMP, JPEG, and GIF. Its MIME mapper
falls back to `image/jpeg` for unknown values. Passing `avif` or `jxl` therefore
creates JPEG bytes that PixelDiet later labels and downloads as AVIF or JXL.

## Codec Choice

- Pin `@jsquash/avif@2.1.1` and `@jsquash/jxl@1.3.0`.
- Run both WebAssembly encoders in a dedicated module worker.
- Load each codec dynamically only when its format is requested.
- Keep all image bytes in the browser; no upload or remote API is introduced.
- Add the installed Apache-2.0 notices to the distributable third-party notice.

Native canvas AVIF encoding is rejected because unsupported MIME types may
silently fall back to another format. Server encoding is rejected because it
would replace the current private, local workflow with a network dependency.

## Encoding Pipeline

1. The main thread sends the source Blob bytes, MIME type, target format, and
   selected numeric quality to the worker.
2. The worker decodes the source with `createImageBitmap`, rasterizes it through
   `OffscreenCanvas`, and obtains RGBA `ImageData`. Before constructing the
   canvas, it requires positive safe-integer dimensions and rejects decoded
   images above exactly 20,000,000 pixels.
3. AVIF uses the selected quality directly, matching alpha quality, with speed
   4 and 8-bit output. JPEG XL uses the selected quality directly with effort 7.
4. The worker wraps the returned ArrayBuffer in the exact target MIME type only
   after validating its binary signature.
5. The processor stores and downloads those exact bytes. It never rewrites JPEG
   bytes with an AVIF or JXL MIME type.

The existing Baja/Media/Alta values remain 35, 50, and 75. PNG, JPEG, and WebP
encoders and policies remain unchanged.

## Output Validation

- AVIF must be an ISO BMFF file with an `ftyp` box declaring `avif` or `avis` as
  its major or compatible brand.
- JPEG XL may be a raw codestream beginning `FF 0A` or a container beginning
  with the standard 12-byte JXL signature box.
- A missing or incorrect signature is an encoding failure and returns the
  existing generic failure result with the original file unchanged.
- Worker crashes and timeouts terminate the current worker and permit a clean
  replacement, following the existing PNG worker lifecycle pattern.

## Preview And Downloads

- AVIF uses the encoded data URL as its preview where the browser supports it.
- JXL always keeps the original image as the on-page preview because browser
  display support is limited.
- `compressedSrc` always contains the real encoded bytes used by individual and
  ZIP downloads. A separate preview field prevents display fallback from
  contaminating downloaded data.
- Output MIME types and filenames remain `image/avif`/`.avif` and
  `image/jxl`/`.jxl`.

## Performance And Failure Handling

- Encoding runs off the main thread and batches remain sequential.
- Decoded AVIF/JXL input is capped at exactly 20,000,000 pixels before canvas
  allocation.
- Dynamic imports keep both large WASM codecs out of the initial application
  path until selected.
- The worker uses a conservative timeout and clears transferred pixel buffers
  after every result.
- No JPEG fallback is allowed. A codec or browser failure keeps the original and
  shows only the existing generic error copy.

## Verification

- Unit tests first reproduce the current JPEG-signature bug for AVIF and JXL.
- Worker tests verify quality options, output signatures, MIME types, malformed
  codec output rejection, timeout/recovery, and alpha/dimension preservation.
- Processor tests verify the real bytes survive data URLs, individual downloads,
  and ZIP downloads with matching MIME types and extensions.
- Browser tests encode a real fixture at 35, 50, and 75, confirm signature and
  size behavior, verify responsive UI remains usable, and confirm no image
  network upload occurs.
- The full suite, production build, and `git diff --check` must pass.
