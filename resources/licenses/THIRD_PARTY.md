# Third-party distribution index — incomplete, not release-ready

Media binaries are downloaded on first launch, or explicitly fetched/built for distribution. Their complete corresponding sources have not been assembled in this checkout. Runtime downloading does not remove distribution obligations. This index is a release checklist, not a replacement for actual license texts and notices.

| Component | Distribution status | Required notice/source material |
| --- | --- | --- |
| FFmpeg / ffprobe | Selected 9.0.2 static builds; hashes unresolved; no binaries shipped | [FFmpeg distribution checklist](FFmpeg.md); exact linked-component sources, build configuration, actual applicable GPL/LGPL texts and distributor-approved source delivery/offer still required |
| Electron / Chromium | Declared package dependency; installation blocked | Preserve Electron's LICENSE and Chromium's LICENSES.chromium.html from the installed distribution |
| whisper.cpp and models | Official v1.9.5 local build; models downloaded with pinned HF LFS SHA256/size | [whisper.cpp provenance and MIT notice](Whisper.md); preserve the source LICENSE and dependency notices when distributing a build |
| yt-dlp | 2026.10.26 standalone macOS release; checksum-verified runtime download/update | [yt-dlp Unlicense/provenance note](yt-dlp.md); standalone Python/FFmpeg-related dependencies retain their own licenses |
| HyperFrames | Not implemented/bundled | Apache-2.0 and dependency notices from the pinned release |
| Remotion | Not implemented/bundled | Applicable Remotion license terms and acknowledgement flow |
| Chrome Headless Shell | Not implemented/bundled | Chrome for Testing release notices and Chromium third-party license bundle |
| RobustVideoMatting | Not implemented/bundled | Exact model weights' license, provenance and redistribution review |

Do not publish a DMG using this checklist as if the licensing gate had passed.
