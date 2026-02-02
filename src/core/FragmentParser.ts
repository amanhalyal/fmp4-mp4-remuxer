import type {
	FlattenOptions,
	Sample,
	TrackConfig,
	TfhdDefaults,
	TrunSample,
} from '../types/Types';
import {
	TFHD_BASE_DATA_OFFSET,
	TFHD_DEFAULT_SAMPLE_DURATION,
	TFHD_DEFAULT_SAMPLE_FLAGS,
	TFHD_DEFAULT_SAMPLE_SIZE,
	TRUN_DATA_OFFSET,
	TRUN_FIRST_SAMPLE_FLAGS,
	TRUN_SAMPLE_CTO,
	TRUN_SAMPLE_DURATION,
	TRUN_SAMPLE_FLAGS,
	TRUN_SAMPLE_SIZE,
} from '../constants/Constants';
import type { Box } from './Mp4BoxParser';
import {
	parseBoxes,
	readI32,
	readU32,
	readU64,
	summarizeTopLevelBoxes,
} from './Mp4BoxParser';

export class FragmentParser {
	private readonly config: TrackConfig;
	private readonly opts: FlattenOptions;

	constructor(config: TrackConfig, opts: FlattenOptions = {}) {
		this.config = config;
		this.opts = opts;
	}

	parse(fragment: Uint8Array): Sample[] {
		const boxes = parseBoxes(fragment);
		this.dbg('fragment boxes:', summarizeTopLevelBoxes(fragment));

		const moofIdxs: number[] = [];
		for (let i = 0; i < boxes.length; i++) {
			if (boxes[i].type === 'moof') moofIdxs.push(i);
		}

		if (!moofIdxs.length) {
			throw new Error('Fragment missing moof');
		}

		const pairs: Array<{ moof: Box; mdat: Box }> = [];
		for (const i of moofIdxs) {
			const moof = boxes[i];
			let mdat: Box | undefined;
			for (let j = i + 1; j < boxes.length; j++) {
				if (boxes[j].type === 'mdat') {
					mdat = boxes[j];
					break;
				}
				if (boxes[j].type === 'moof') break;
			}
			if (mdat) pairs.push({ moof, mdat });
		}

		if (!pairs.length) {
			throw new Error('Fragment has moof but no following mdat');
		}

		this.dbg('moof+mdat pairs=', pairs.length);

		const out: Sample[] = [];
		let lastEnd = 0;
		let intraOffset = 0;

		for (let k = 0; k < pairs.length; k++) {
			const pairOpts = this.opts.debug && (k < 2) ? this.opts : { ...this.opts, debug: false };
			const raw = this.extractSamplesFromMoofMdat(fragment, pairs[k].moof, pairs[k].mdat, pairOpts);
			if (!raw.length) continue;

			const firstRawDts = raw[0].dts;
			if (firstRawDts + intraOffset < lastEnd) {
				intraOffset = lastEnd - firstRawDts;
			}

			for (const s of raw) {
				s.dts += intraOffset;
				s.cts += intraOffset;
				out.push(s);
				const end = s.dts + Math.max(0, s.duration);
				if (end > lastEnd) lastEnd = end;
			}
		}

		return out;
	}

	private dbg(...args: unknown[]) {
		if (this.opts?.debug) {
			// eslint-disable-next-line no-console
			console.log('[mp4muxer]', ...args);
		}
	}

	private readFullBoxHeader(data: Uint8Array, box: Box): { version: number; flags: number } {
		const off = box.start + box.headerSize;
		if (off + 4 > box.end) throw new Error(`Invalid full box ${box.type}`);
		const version = data[off];
		const flags = ((data[off + 1] << 16) | (data[off + 2] << 8) | data[off + 3]) >>> 0;
		return { version, flags };
	}

	private parseTfhd(traf: Uint8Array, tfhdBox: Box): TfhdDefaults {
		const { flags } = this.readFullBoxHeader(traf, tfhdBox);
		let off = tfhdBox.start + tfhdBox.headerSize + 4;
		const trackId = readU32(traf, off);
		off += 4;

		const out: TfhdDefaults = { trackId };

		if (flags & TFHD_BASE_DATA_OFFSET) {
			out.baseDataOffset = readU64(traf, off);
			off += 8;
		}

		if (flags & 0x000002) off += 4; // sample_description_index
		if (flags & TFHD_DEFAULT_SAMPLE_DURATION) {
			out.defaultSampleDuration = readU32(traf, off);
			off += 4;
		}
		if (flags & TFHD_DEFAULT_SAMPLE_SIZE) {
			out.defaultSampleSize = readU32(traf, off);
			off += 4;
		}
		if (flags & TFHD_DEFAULT_SAMPLE_FLAGS) {
			out.defaultSampleFlags = readU32(traf, off);
			off += 4;
		}

		return out;
	}

	private parseTfdt(traf: Uint8Array, tfdtBox: Box): bigint {
		const { version } = this.readFullBoxHeader(traf, tfdtBox);
		const off = tfdtBox.start + tfdtBox.headerSize + 4;
		if (version === 0) {
			return BigInt(readU32(traf, off));
		}
		if (version === 1) {
			return readU64(traf, off);
		}
		throw new Error(`Unsupported tfdt version ${version}`);
	}

	private parseTrun(traf: Uint8Array, trunBox: Box): {
		version: number;
		flags: number;
		dataOffset?: number;
		firstSampleFlags?: number;
		samples: TrunSample[];
	} {
		const { version, flags } = this.readFullBoxHeader(traf, trunBox);
		let off = trunBox.start + trunBox.headerSize + 4;
		const sampleCount = readU32(traf, off);
		off += 4;

		let dataOffset: number | undefined;
		if (flags & TRUN_DATA_OFFSET) {
			dataOffset = readI32(traf, off);
			off += 4;
		}

		let firstSampleFlags: number | undefined;
		if (flags & TRUN_FIRST_SAMPLE_FLAGS) {
			firstSampleFlags = readU32(traf, off);
			off += 4;
		}

		const samples: TrunSample[] = [];
		for (let i = 0; i < sampleCount; i++) {
			const s: TrunSample = {};
			if (flags & TRUN_SAMPLE_DURATION) {
				s.duration = readU32(traf, off);
				off += 4;
			}
			if (flags & TRUN_SAMPLE_SIZE) {
				s.size = readU32(traf, off);
				off += 4;
			}
			if (flags & TRUN_SAMPLE_FLAGS) {
				s.flags = readU32(traf, off);
				off += 4;
			}
			if (flags & TRUN_SAMPLE_CTO) {
				s.cto = version === 1 ? readI32(traf, off) : readU32(traf, off);
				off += 4;
			}
			samples.push(s);
		}

		return { version, flags, dataOffset, firstSampleFlags, samples };
	}

	private getSampleFlags(
		i: number,
		trun: ReturnType<FragmentParser['parseTrun']>,
		tfhd: TfhdDefaults,
		trunSample: TrunSample
	): number {
		if (typeof trunSample.flags === 'number') return trunSample.flags;
		if (i === 0 && typeof trun.firstSampleFlags === 'number') return trun.firstSampleFlags;
		if (typeof tfhd.defaultSampleFlags === 'number') return tfhd.defaultSampleFlags;
		return 0;
	}

	private isKeyframeFromFlags(sampleFlags: number): boolean {
		const isSync = (sampleFlags & 0x10000) === 0;
		return isSync;
	}

	private safeBigintToNumber(v: bigint, label: string): number {
		if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new Error(`${label} too large for JS number`);
		}
		return Number(v);
	}

	private extractSamplesFromMoofMdat(
		fileBytes: Uint8Array,
		moof: Box,
		mdat: Box,
		opts: FlattenOptions
	): Sample[] {
		const moofStart = moof.start;
		const mdatPayloadStart = mdat.start + mdat.headerSize;
		const mdatPayloadEnd = mdat.end;

		const moofContent = fileBytes.slice(moof.start + moof.headerSize, moof.end);
		const trafBoxes = parseBoxes(moofContent).filter((b) => b.type === 'traf');

		const out: Sample[] = [];

		for (const trafBox of trafBoxes) {
			const traf = moofContent.slice(trafBox.start, trafBox.end);
			const trafInner = traf.slice(trafBox.headerSize);
			const innerBoxes = parseBoxes(trafInner);

			const tfhdBox = innerBoxes.find((b) => b.type === 'tfhd');
			if (!tfhdBox) continue;
			const tfhd = this.parseTfhd(trafInner, tfhdBox);
			if (tfhd.trackId !== this.config.trackId) continue;

			const tfdtBox = innerBoxes.find((b) => b.type === 'tfdt');
			if (!tfdtBox) throw new Error('traf missing tfdt');
			const baseDecodeTime = this.parseTfdt(trafInner, tfdtBox);
			let dts = this.safeBigintToNumber(baseDecodeTime, 'tfdt.baseMediaDecodeTime');

			if (opts.debug) {
				// eslint-disable-next-line no-console
				console.log('[mp4muxer]', 'traf trackId=', tfhd.trackId, 'tfdt=', baseDecodeTime.toString(), 'tfhd=', {
					baseDataOffset: tfhd.baseDataOffset?.toString(),
					defaultSampleDuration: tfhd.defaultSampleDuration,
					defaultSampleSize: tfhd.defaultSampleSize,
					defaultSampleFlags: tfhd.defaultSampleFlags,
				});
			}

			const baseDataOffset = tfhd.baseDataOffset ?? BigInt(moofStart);
			const truns = innerBoxes.filter((b) => b.type === 'trun');
			if (!truns.length) throw new Error('traf missing trun');

			for (const trunBox of truns) {
				const trun = this.parseTrun(trafInner, trunBox);

				let dataStart: number;
				if (typeof trun.dataOffset === 'number') {
					dataStart = this.safeBigintToNumber(baseDataOffset + BigInt(trun.dataOffset), 'trun.data_offset');
				} else {
					if (!this.opts.allowTrunDataOffsetFallback) {
						throw new Error('trun missing data_offset (required for byte-accurate extraction)');
					}
					dataStart = typeof tfhd.baseDataOffset === 'bigint' ? moof.end : mdatPayloadStart;
				}
				let cursor = dataStart;

				let zeroDurationCount = 0;

				for (let i = 0; i < trun.samples.length; i++) {
					const ts = trun.samples[i];
					const duration = typeof ts.duration === 'number'
						? ts.duration
						: (typeof tfhd.defaultSampleDuration === 'number' ? tfhd.defaultSampleDuration : 0);
					const size = typeof ts.size === 'number'
						? ts.size
						: (typeof tfhd.defaultSampleSize === 'number' ? tfhd.defaultSampleSize : 0);

					if (duration === 0) zeroDurationCount++;

					if (!Number.isFinite(size) || size <= 0) {
						throw new Error('Missing sample_size (cannot extract mdat bytes)');
					}

					if (cursor < mdatPayloadStart || cursor + size > mdatPayloadEnd) {
						throw new Error('Sample byte range is outside mdat payload (data_offset/base_data_offset mismatch)');
					}

					const sampleFlags = this.getSampleFlags(i, trun, tfhd, ts);
					const cto = typeof ts.cto === 'number' ? ts.cto : 0;
					const cts = dts + cto;

					const data = fileBytes.slice(cursor, cursor + size);
					out.push({
						dts,
						cts,
						duration,
						size,
						isKeyframe: this.isKeyframeFromFlags(sampleFlags),
						data,
					});

					cursor += size;
					dts += Math.max(0, duration);
				}

				if (opts.debug) {
					// eslint-disable-next-line no-console
					console.log('[mp4muxer]', 'trun extracted', {
						samples: trun.samples.length,
						zeroDurationCount,
						dataStart,
						consumedBytes: cursor - dataStart,
					});
				}

				const sumSizes = trun.samples.reduce((s, x) => s + (x.size ?? tfhd.defaultSampleSize ?? 0), 0);
				if (sumSizes <= 0) {
					throw new Error('trun sample sizes could not be resolved');
				}
				if (cursor !== dataStart + sumSizes) {
					throw new Error('Sample sizes do not sum to consumed mdat bytes');
				}

				if (zeroDurationCount > 0 && opts.debug) {
					// eslint-disable-next-line no-console
					console.log('[mp4muxer]', 'trun had zero-duration samples=', zeroDurationCount);
				}
			}
		}

		return out;
	}
}

export default FragmentParser;
