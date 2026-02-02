export interface Sample {
  dts: number;
  cts: number;
  duration: number;
  size: number;
  isKeyframe: boolean;
  data: Uint8Array;
}

export type FlatMp4Result = {
  buffer: ArrayBuffer;
  idrTimestamps: number[];
  discontinuityDetected?: boolean;
};

export type FlattenOptions = {
  allowTrunDataOffsetFallback?: boolean;
  normalizeAcrossFiles?: boolean;
  debug?: boolean;
  debugFileLimit?: number;
};

export type TrackConfig = {
  trackId: number;
  timescale: number;
  width: number;
  height: number;
  stsd: Uint8Array;
  ftyp?: Uint8Array;
};

export type Box = {
  type: string;
  start: number;
  size: number;
  headerSize: number;
  end: number;
};

export type TfhdDefaults = {
  trackId: number;
  baseDataOffset?: bigint;
  defaultSampleDuration?: number;
  defaultSampleSize?: number;
  defaultSampleFlags?: number;
};

export type TrunSample = {
  duration?: number;
  size?: number;
  flags?: number;
  cto?: number;
};