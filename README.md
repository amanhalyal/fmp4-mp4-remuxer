# fmp4-mp4-remuxer

A small TypeScript library that remuxes fragmented MP4 (fMP4) segments into a single playable MP4.

- Input: an init segment (`moov`) + one or more media fragments (`moof`+`mdat`)
- Output: a new MP4 file (`ftyp`+`moov`+`mdat`)

## Install

```bash
npm i fmp4-mp4-remuxer
```

## Usage

```ts
import { flattenFmp4ToMp4WithOptions } from 'fmp4-mp4-remuxer';

const { buffer, idrTimestamps } = await flattenFmp4ToMp4WithOptions(
  [initSegment, ...fragments],
  { normalizeAcrossFiles: true }
);

// buffer is an ArrayBuffer containing the full MP4
```

## CLI

After building (or when installed as a package), you can remux from the command line:

```bash
npx fmp4-mp4-remuxer --init init.mp4 --out out.mp4 frag-001.m4s frag-002.m4s
```

Or read fragments from a directory (sorted by filename):

```bash
npx fmp4-mp4-remuxer --init init.mp4 --out out.mp4 --fragments-dir ./frags --normalize-across-files
```

## API

- `flattenFmp4ToMp4(buffers)`
- `flattenFmp4ToMp4WithOptions(buffers, opts)`
- `Fmp4Flattener` class

`opts` maps to `FlattenOptions`.

## Limitations / Notes

- Currently targets the **video** track only.
- Output MP4 is built fully in-memory (large inputs will use large RAM).
- Fragments are expected to be byte-accurate (`trun.data_offset` preferred). You can enable `allowTrunDataOffsetFallback` for some streams.

## Development

```bash
npm install
npm run build
npm run typecheck
```

## License

Not set yet. Add a license before publishing publicly. Test
