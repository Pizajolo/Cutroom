# whisper.cpp and model provenance

whisper.cpp v1.9.5: https://github.com/ggml-org/whisper.cpp/tree/v1.9.5

MIT License — Copyright (c) 2023-2026 The ggml authors.

Official license: https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/LICENSE

Cutroom does not download community-built macOS CLI executables. `npm run build:whisper` builds the official source with static libraries and embedded Metal after verifying a reviewed source SHA256. The source pin is currently unresolved; normal builds fail closed. `--pin` only records the source digest for separate human review and does not build.

Models come from https://huggingface.co/ggerganov/whisper.cpp, converted from OpenAI Whisper. Base/small/medium/large-v3-turbo byte counts and SHA256 LFS oids are recorded in resources/tools-manifest.json. Model files are downloaded separately and verified before being reported installed. Preserve the upstream model/license provenance and the actual MIT license text when distributing model weights or compiled software. The runtime downloader is not a completed redistribution-license audit.
