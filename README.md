# fMP4 → MP4 Remuxer

Browser-first fMP4 to MP4 remuxer designed to reconstruct live streams
directly in the browser, offloading processing from backend servers.

## Why browser-side?
- Reduces backend compute
- Handles live streaming constraints
- Works under memory and ordering limits

## Architecture
- Init segment parsing
- Fragment parsing
- Timeline normalization
- MP4 reconstruction

## Streaming Simulation
A lightweight WebSocket server simulates real-world fMP4 delivery
to test ordering, jitter, and partial data.

## Status
Core remuxing logic complete. Tests and CLI in progress.
