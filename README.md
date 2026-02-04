# fmp4-mp4-remuxer

TypeScript library and CLI to remux fragmented MP4 (fMP4) inputs into a single playable MP4.

This tool reconstructs timeline metadata, preserves decode and composition order, and produces a clean:

`ftyp + moov + mdat`

from fragmented sources such as:

- Self-contained fMP4 recordings
- DASH or CMAF init plus `.m4s` segments
- WebRTC or browser capture fragments

---

## Features

- Pure TypeScript implementation with no FFmpeg dependency
- Supports self-contained fragmented MP4 files and init plus fragment workflows
- Correct DTS and PTS normalization across fragments
- Preserves B-frame composition offsets
- Outputs standard progressive MP4 playable in common players
- Lightweight CLI and library API
- Zero runtime dependencies

---

## Install

```bash
npm install fmp4-mp4-remuxer
```

## When to use this

Use this library when:

- FFmpeg concat fails on fragmented MP4
- You downloaded DASH or CMAF segments and need a single MP4
- You recorded browser or WebRTC video producing multiple fragments
- You need timeline-accurate remuxing in Node.js or the browser

## Library usage

```ts
import { flattenFmp4ToMp4WithOptions } from 'fmp4-mp4-remuxer';

const { buffer, idrTimestamps } = await flattenFmp4ToMp4WithOptions(
  [initSegment, ...fragments],
  { normalizeAcrossFiles: true }
);

// buffer is an ArrayBuffer containing the final MP4
```

## CLI usage

### Basic

```bash
npx fmp4-mp4-remuxer --out out.mp4
```

By default, the CLI reads all `.mp4` or `.m4s` files from:

`./fmp4-files`

sorted naturally by filename.

### Merge self-contained fragmented MP4 files

```bash
npx fmp4-mp4-remuxer a.mp4 b.mp4 c.mp4 --out merged.mp4
```

### Merge DASH init plus fragments

```bash
npx fmp4-mp4-remuxer \
  --init init.mp4 \
  chunk001.m4s chunk002.m4s \
  --out merged.mp4
```

### Use a custom directory

```bash
npx fmp4-mp4-remuxer \
  --dir ./fragments \
  --out merged.mp4 \
  --normalize-across-files
```

## CLI options

| Option | Description |
| --- | --- |
| `--dir <dir>` | Directory containing fragmented MP4 inputs |
| `--init <path>` | Optional init segment for DASH-style inputs |
| `--out <path>` | Output MP4 path. Default is `./out.mp4` |
| `--normalize-across-files` | Normalize timestamps across inputs. Enabled by default |
| `--no-normalize-across-files` | Disable cross-file normalization |
| `--allow-trun-data-offset-fallback` | Enable fallback parsing when `trun.data_offset` is missing |
| `-h`, `--help` | Show help |

## API surface

### Functions

- `flattenFmp4ToMp4(buffers)`
- `flattenFmp4ToMp4WithOptions(buffers, options)`

### Classes

- `Fmp4Flattener`

Options map to `FlattenOptions`.

## How it works

- Parse MP4 boxes such as `moov`, `moof`, and `mdat`
- Extract samples and timing metadata
- Normalize DTS and PTS across fragments
- Rebuild sample tables and durations
- Emit a clean progressive MP4

All steps are implemented in TypeScript without FFmpeg.

## Limitations

- Currently targets the video track only
- Output MP4 is built fully in memory, so large inputs require large RAM
- Requires valid fragmented MP4 structure

Some malformed streams may require:

- `--allow-trun-data-offset-fallback`

## Development

```bash
npm install
npm run build
npm run typecheck
```

## License

Not set yet. Add a license such as MIT before publishing publicly.

## Purpose

Fragmented MP4 stitching in pure JavaScript is poorly documented, rarely implemented correctly, and often dependent on FFmpeg.

This project provides a small, correct, dependency-free remuxer usable in Node.js tooling and future browser or WebAssembly workflows.
