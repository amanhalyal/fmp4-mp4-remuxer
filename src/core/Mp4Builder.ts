import type { FlatMp4Result, Sample, TrackConfig } from '../types/Types';
import { concat } from './Mp4BoxParser';

function rle(values: number[]): Array<{ count: number; value: number }> {
	const out: Array<{ count: number; value: number }> = [];
	for (const v of values) {
		const last = out[out.length - 1];
		if (last && last.value === v) last.count++;
		else out.push({ count: 1, value: v });
	}
	return out;
}

class ByteWriter {
	private buf: Uint8Array;
	private off = 0;

	constructor(size: number) {
		this.buf = new Uint8Array(size);
	}

	get bytes(): Uint8Array {
		return this.buf;
	}

	writeU8(v: number) {
		this.buf[this.off++] = v & 0xff;
	}

	writeU16(v: number) {
		this.buf[this.off++] = (v >>> 8) & 0xff;
		this.buf[this.off++] = v & 0xff;
	}

	writeU24(v: number) {
		this.buf[this.off++] = (v >>> 16) & 0xff;
		this.buf[this.off++] = (v >>> 8) & 0xff;
		this.buf[this.off++] = v & 0xff;
	}

	writeU32(v: number) {
		this.buf[this.off++] = (v >>> 24) & 0xff;
		this.buf[this.off++] = (v >>> 16) & 0xff;
		this.buf[this.off++] = (v >>> 8) & 0xff;
		this.buf[this.off++] = v & 0xff;
	}

	writeU64(v: bigint) {
		const hi = Number((v >> 32n) & 0xffffffffn);
		const lo = Number(v & 0xffffffffn);
		this.writeU32(hi);
		this.writeU32(lo);
	}

	writeBytes(b: Uint8Array) {
		this.buf.set(b, this.off);
		this.off += b.byteLength;
	}

	writeStr4(s: string) {
		this.writeU8(s.charCodeAt(0));
		this.writeU8(s.charCodeAt(1));
		this.writeU8(s.charCodeAt(2));
		this.writeU8(s.charCodeAt(3));
	}
}

function box(type: string, payload: Uint8Array): Uint8Array {
	const size = 8 + payload.byteLength;
	const w = new ByteWriter(size);
	w.writeU32(size);
	w.writeStr4(type);
	w.writeBytes(payload);
	return w.bytes;
}

function fullBox(type: string, version: number, flags: number, payload: Uint8Array): Uint8Array {
	const header = new ByteWriter(4);
	header.writeU8(version);
	header.writeU24(flags);
	return box(type, concat([header.bytes, payload]));
}

function mvhd(timescale: number, duration: number): Uint8Array {
	const payload = new ByteWriter(4 + 4 + 4 + 4 + 4 + 2 + 2 + 8 + 36 + 24 + 4);
	payload.writeU32(0);
	payload.writeU32(0);
	payload.writeU32(timescale);
	payload.writeU32(duration >>> 0);

	payload.writeU32(0x00010000);
	payload.writeU16(0);
	payload.writeU16(0);
	payload.writeU32(0);
	payload.writeU32(0);

	payload.writeU32(0x00010000);
	payload.writeU32(0);
	payload.writeU32(0);
	payload.writeU32(0);
	payload.writeU32(0x00010000);
	payload.writeU32(0);
	payload.writeU32(0);
	payload.writeU32(0);
	payload.writeU32(0x40000000);

	for (let i = 0; i < 6; i++) payload.writeU32(0);

	payload.writeU32(2);
	return fullBox('mvhd', 0, 0, payload.bytes);
}

function tkhd(trackId: number, duration: number, width: number, height: number): Uint8Array {
	const payload = new ByteWriter(4 + 4 + 4 + 4 + 4 + 8 + 2 + 2 + 2 + 2 + 36 + 4 + 4);
	payload.writeU32(0);
	payload.writeU32(0);
	payload.writeU32(trackId);
	payload.writeU32(0);
	payload.writeU32(duration >>> 0);

	payload.writeU32(0);
	payload.writeU32(0);

	payload.writeU16(0);
	payload.writeU16(0);
	payload.writeU16(0);
	payload.writeU16(0);

	payload.writeU32(0x00010000);
	payload.writeU32(0);
	payload.writeU32(0);
	payload.writeU32(0);
	payload.writeU32(0x00010000);
	payload.writeU32(0);
	payload.writeU32(0);
	payload.writeU32(0);
	payload.writeU32(0x40000000);

	payload.writeU32((width << 16) >>> 0);
	payload.writeU32((height << 16) >>> 0);
	return fullBox('tkhd', 0, 0x000007, payload.bytes);
}

function mdhd(timescale: number, duration: number): Uint8Array {
	const payload = new ByteWriter(4 + 4 + 4 + 4 + 2 + 2);
	payload.writeU32(0);
	payload.writeU32(0);
	payload.writeU32(timescale);
	payload.writeU32(duration >>> 0);
	payload.writeU16(0);
	payload.writeU16(0);
	return fullBox('mdhd', 0, 0, payload.bytes);
}

function hdlr(handlerType: string, name: string): Uint8Array {
	const nameBytes = new TextEncoder().encode(name + '\0');
	const payload = new ByteWriter(4 + 4 + 12 + nameBytes.byteLength);
	payload.writeU32(0);
	payload.writeStr4(handlerType);
	payload.writeU32(0);
	payload.writeU32(0);
	payload.writeU32(0);
	payload.writeBytes(nameBytes);
	return fullBox('hdlr', 0, 0, payload.bytes);
}

function vmhd(): Uint8Array {
	const payload = new ByteWriter(2 + 2 + 2 + 2);
	payload.writeU16(0);
	payload.writeU16(0);
	payload.writeU16(0);
	payload.writeU16(0);
	return fullBox('vmhd', 0, 0x000001, payload.bytes);
}

function dref(): Uint8Array {
	const url = fullBox('url ', 0, 0x000001, new Uint8Array());
	const payload = new ByteWriter(4 + url.byteLength);
	payload.writeU32(1);
	payload.writeBytes(url);
	return fullBox('dref', 0, 0, payload.bytes);
}

function sttsBox(durations: number[]): Uint8Array {
	const entries = rle(durations);
	const payload = new ByteWriter(4 + entries.length * 8);
	payload.writeU32(entries.length);
	for (const e of entries) {
		payload.writeU32(e.count);
		payload.writeU32(e.value >>> 0);
	}
	return fullBox('stts', 0, 0, payload.bytes);
}

function cttsBox(offsets: number[]): Uint8Array | null {
	const any = offsets.some((o) => o !== 0);
	if (!any) return null;

	const hasNegative = offsets.some((o) => o < 0);

	const entries = rle(offsets);
	const payload = new ByteWriter(4 + entries.length * 8);
	payload.writeU32(entries.length);
	for (const e of entries) {
		payload.writeU32(e.count);
		payload.writeU32((e.value | 0) >>> 0);
	}
	return fullBox('ctts', hasNegative ? 1 : 0, 0, payload.bytes);
}

function stssBox(syncSampleNumbers: number[]): Uint8Array | null {
	if (!syncSampleNumbers.length) return null;
	const payload = new ByteWriter(4 + syncSampleNumbers.length * 4);
	payload.writeU32(syncSampleNumbers.length);
	for (const n of syncSampleNumbers) payload.writeU32(n >>> 0);
	return fullBox('stss', 0, 0, payload.bytes);
}

function stszBox(sizes: number[]): Uint8Array {
	const payload = new ByteWriter(4 + 4 + 4 + sizes.length * 4);
	payload.writeU32(0);
	payload.writeU32(sizes.length);
	for (const s of sizes) payload.writeU32(s >>> 0);
	return fullBox('stsz', 0, 0, payload.bytes);
}

function stscBox(): Uint8Array {
	const payload = new ByteWriter(4 + 12);
	payload.writeU32(1);
	payload.writeU32(1);
	payload.writeU32(1);
	payload.writeU32(1);
	return fullBox('stsc', 0, 0, payload.bytes);
}

function stcoBox(offsets: Array<number | bigint>, useCo64: boolean): Uint8Array {
	const entryCount = offsets.length;
	const payload = new ByteWriter(4 + (useCo64 ? entryCount * 8 : entryCount * 4));
	payload.writeU32(entryCount);
	if (useCo64) {
		for (const o of offsets) payload.writeU64(typeof o === 'bigint' ? o : BigInt(o >>> 0));
		return fullBox('co64', 0, 0, payload.bytes);
	}

	for (const o of offsets) payload.writeU32(typeof o === 'bigint' ? Number(o) : (o >>> 0));
	return fullBox('stco', 0, 0, payload.bytes);
}

function stbl(
	stsd: Uint8Array,
	stts: Uint8Array,
	ctts: Uint8Array | null,
	stss: Uint8Array | null,
	stsc: Uint8Array,
	stsz: Uint8Array,
	stco: Uint8Array
): Uint8Array {
	const children = [stsd, stts];
	if (ctts) children.push(ctts);
	if (stss) children.push(stss);
	children.push(stsc, stsz, stco);
	return box('stbl', concat(children));
}

function minf(stblBox: Uint8Array): Uint8Array {
	const dinfBox = box('dinf', concat([dref()]));
	return box('minf', concat([vmhd(), dinfBox, stblBox]));
}

function mdia(mdhdBox: Uint8Array, hdlrBox: Uint8Array, minfBox: Uint8Array): Uint8Array {
	return box('mdia', concat([mdhdBox, hdlrBox, minfBox]));
}

function trak(tkhdBox: Uint8Array, mdiaBox: Uint8Array): Uint8Array {
	return box('trak', concat([tkhdBox, mdiaBox]));
}

function moov(mvhdBox: Uint8Array, trakBox: Uint8Array): Uint8Array {
	return box('moov', concat([mvhdBox, trakBox]));
}

function minimalFtyp(): Uint8Array {
	const payload = new ByteWriter(4 + 4 + 4 * 4);
	payload.writeStr4('isom');
	payload.writeU32(0x00000200);
	payload.writeStr4('isom');
	payload.writeStr4('iso2');
	payload.writeStr4('avc1');
	payload.writeStr4('mp41');
	return box('ftyp', payload.bytes);
}

function safeBigintToNumber(v: bigint, label: string): number {
	if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error(`${label} too large for JS number`);
	}
	return Number(v);
}

export class Mp4Builder {
	build(config: TrackConfig, samples: Sample[]): FlatMp4Result {
		const normalized = samples;
		if (!normalized.length) throw new Error('No samples to mux');

		const idrTimestamps = normalized
			.filter((s) => s.isKeyframe)
			.map((s) => s.dts / config.timescale);

		const durations = normalized.map((s) => s.duration);
		const offsets = normalized.map((s) => s.cts - s.dts);
		const sizes = normalized.map((s) => s.size);
		const syncSamples = normalized
			.map((s, idx) => ({ s, n: idx + 1 }))
			.filter((x) => x.s.isKeyframe)
			.map((x) => x.n);

		const trackDuration = durations.reduce((a, b) => a + b, 0);
		const movieTimescale = config.timescale;
		const movieDuration = trackDuration;

		const mdatPayloadSize = normalized.reduce((sum, s) => sum + s.data.byteLength, 0);
		const mdatData = new Uint8Array(mdatPayloadSize);
		let writeOff = 0;
		for (const s of normalized) {
			mdatData.set(s.data, writeOff);
			writeOff += s.data.byteLength;
		}

		const ftypBox = config.ftyp ?? minimalFtyp();

		let useCo64 = false;
		for (let pass = 0; pass < 2; pass++) {
			const stts = sttsBox(durations);
			const ctts = cttsBox(offsets);
			const stss = stssBox(syncSamples);
			const stsc = stscBox();
			const stsz = stszBox(sizes);

			const placeholderOffsets = new Array<bigint | number>(normalized.length).fill(useCo64 ? 0n : 0);
			const stco = stcoBox(placeholderOffsets, useCo64);

			const stblBox = stbl(config.stsd, stts, ctts, stss, stsc, stsz, stco);
			const minfBox = minf(stblBox);
			const mdiaBox = mdia(mdhd(config.timescale, trackDuration), hdlr('vide', 'VideoHandler'), minfBox);
			const trakBox = trak(tkhd(config.trackId, movieDuration, config.width, config.height), mdiaBox);
			const moovBox = moov(mvhd(movieTimescale, movieDuration), trakBox);

			const mdatSize = BigInt(8 + mdatData.byteLength);
			const needsLargeMdat = mdatSize > 0xffffffffn;
			const mdatHeaderSize = needsLargeMdat ? 16 : 8;

			const mdatStart = BigInt(ftypBox.byteLength + moovBox.byteLength);
			const firstData = mdatStart + BigInt(mdatHeaderSize);

			const chunkOffsetsBig: bigint[] = [];
			let run = 0n;
			for (const s of normalized) {
				chunkOffsetsBig.push(firstData + run);
				run += BigInt(s.data.byteLength);
			}

			const maxOffsetBig = chunkOffsetsBig.reduce((m, o) => (o > m ? o : m), 0n);
			const shouldUseCo64 = maxOffsetBig >= 0x1_0000_0000n;

			if (pass === 0 && shouldUseCo64 && !useCo64) {
				useCo64 = true;
				continue;
			}

			const chunkOffsets: Array<number | bigint> = useCo64
				? chunkOffsetsBig
				: chunkOffsetsBig.map((o) => {
						if (o >= 0x1_0000_0000n) {
							throw new Error('Chunk offset does not fit in stco');
						}
						return safeBigintToNumber(o, 'chunk offset');
					});

			const stcoReal = stcoBox(chunkOffsets, useCo64);
			const stblReal = stbl(config.stsd, stts, ctts, stss, stsc, stsz, stcoReal);
			const minfReal = minf(stblReal);
			const mdiaReal = mdia(mdhd(config.timescale, trackDuration), hdlr('vide', 'VideoHandler'), minfReal);
			const trakReal = trak(tkhd(config.trackId, movieDuration, config.width, config.height), mdiaReal);
			const moovReal = moov(mvhd(movieTimescale, movieDuration), trakReal);

			let mdatBox: Uint8Array;
			if (needsLargeMdat) {
				const header = new ByteWriter(16);
				header.writeU32(1);
				header.writeStr4('mdat');
				header.writeU64(BigInt(16 + mdatData.byteLength));
				mdatBox = concat([header.bytes, mdatData]);
			} else {
				const header = new ByteWriter(8);
				header.writeU32(8 + mdatData.byteLength);
				header.writeStr4('mdat');
				mdatBox = concat([header.bytes, mdatData]);
			}

			const file = concat([ftypBox, moovReal, mdatBox]);
			const out = new ArrayBuffer(file.byteLength);
			new Uint8Array(out).set(file);
			return { buffer: out, idrTimestamps };
		}

		throw new Error('Failed to build MP4');
	}
}

export default Mp4Builder;
