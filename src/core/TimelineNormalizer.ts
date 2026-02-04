import type { FlattenOptions, Sample } from '../types/Types';

export class TimelineNormalizer {
	inferDurationsWithinFile(samples: Sample[]): { samples: Sample[]; fileDuration: number } {
		if (!samples.length) return { samples: [], fileDuration: 0 };

		const ordered = samples.map((s) => ({ ...s }));

		for (let i = 0; i < ordered.length; i++) {
			const cur = ordered[i];
			const next = ordered[i + 1];
			if (cur.duration === 0) {
				if (next) {
					const delta = next.dts - cur.dts;
					cur.duration = Number.isFinite(delta) && delta > 0 ? delta : 1;
				} else {
					cur.duration = ordered.length > 1 ? Math.max(1, ordered[i - 1].duration) : 1;
				}
			}
		}

		let fileDuration = 0;
		for (const s of ordered) {
			const end = s.dts + Math.max(0, s.duration);
			if (end > fileDuration) fileDuration = end;
		}

		return { samples: ordered, fileDuration };
	}

	normalize(
		samples: Sample[],
		options: { preserveOrder?: boolean } = {}
	): { samples: Sample[]; discontinuityDetected: boolean } {
		const withIndex = samples.map((s, i) => ({ s: { ...s }, i }));
		if (!options.preserveOrder) {
			withIndex.sort((a, b) => (a.s.dts - b.s.dts) || (a.s.cts - b.s.cts) || (a.i - b.i));
		}

		let discontinuityDetected = false;

		for (let i = 0; i < withIndex.length; i++) {
			const cur = withIndex[i].s;

			if (!Number.isFinite(cur.dts) || cur.dts < 0) cur.dts = 0;
			if (!Number.isFinite(cur.cts) || cur.cts < 0) cur.cts = cur.dts;
			if (!Number.isFinite(cur.duration) || cur.duration < 0) cur.duration = 0;

			if (i > 0) {
				const prev = withIndex[i - 1].s;
					let targetDts = cur.dts;
					if (targetDts < prev.dts) targetDts = prev.dts;
					const prevEnd = prev.dts + Math.max(1, prev.duration);
					if (targetDts < prevEnd) targetDts = prevEnd;

					const shift = targetDts - cur.dts;
					if (shift > 0) {
						cur.dts += shift;
						cur.cts += shift;
					}
			}

			if (cur.cts < cur.dts) cur.cts = cur.dts;
		}

		for (let i = 0; i < withIndex.length; i++) {
			const cur = withIndex[i].s;
			const next = withIndex[i + 1]?.s;

			if (cur.duration === 0) {
				if (next) {
					const delta = next.dts - cur.dts;
					if (Number.isFinite(delta) && delta > 1) discontinuityDetected = true;
					cur.duration = Number.isFinite(delta) && delta > 0 ? delta : 1;
				} else {
					cur.duration = withIndex.length > 1 ? Math.max(1, withIndex[i - 1].s.duration) : 1;
				}
			}
		}

		return { samples: withIndex.map((x) => x.s), discontinuityDetected };
	}

	normalizeFragments(
		fragmentsSamples: Sample[][],
		opts: FlattenOptions = {}
	): { samples: Sample[]; discontinuityDetected: boolean } {
		const normalizeAcrossFiles = opts.normalizeAcrossFiles ?? true;

		const allSamples: Sample[] = [];
		let timelineOffset = 0;

		for (const fileSamples of fragmentsSamples) {
			const inferred = this.inferDurationsWithinFile(fileSamples);

			if (normalizeAcrossFiles) {
				for (const s of inferred.samples) {
					s.dts += timelineOffset;
					s.cts += timelineOffset;
				}
				timelineOffset += inferred.fileDuration;
			}

			allSamples.push(...inferred.samples);
		}

		// Preserve decode order after cross-file offsetting.
		return this.normalize(allSamples, { preserveOrder: true });
	}
}

export default TimelineNormalizer;
