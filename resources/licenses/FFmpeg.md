# FFmpeg distribution status — NOT release-ready

No FFmpeg binary has been downloaded or distributed by this checkout. The manifest currently contains unresolved (`null`) checksum pins because the source host was blocked by the development sandbox.

Selected upstream build source: <https://ffmpeg.martin-riedl.de/> (macOS arm64 / amd64 release 9.0.2). Exact artifact/checksum URLs are in `resources/tools-manifest.json`. The upstream build-script link is <https://git.martin-riedl.de/ffmpeg/build-script>. These links do not constitute complete corresponding source for a binary.

Before distributing either architecture:

- Download and review the binary, pins, build configuration and code signature; run `npm run verify:ffmpeg` on both architectures.
- Obtain the **exact** build scripts, patches, FFmpeg source and sources for all linked libraries matching each artifact. Archive them with the release, not merely a link to the latest repository. Record provenance and digests.
- Include the actual applicable GPL/LGPL texts, copyright notices and all linked-component notices. Reject non-redistributable / `--enable-nonfree` builds. Verify static/non-system dependency packaging.
- Have the distributor approve and supply their real legal name, source-delivery contact, and an appropriate GPL-compliant source delivery mechanism or written offer. There is deliberately no invented source-contact address or purported legal offer here.
- Make the corresponding source available as required for the chosen distribution method and retain it for the legally required period.

A release must not treat this checklist as a fulfilled source offer or license notice bundle. Packaging/signing and legal distribution gates are pending.
