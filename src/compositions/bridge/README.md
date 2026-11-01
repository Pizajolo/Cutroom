# Composition bridge hosts

Reserved for the separate, static HyperFrames and Remotion host entries (T21/T26). They are **not implemented** in the renderer-foundation milestone; the renderer must not load an arbitrary composition into the application document as a substitute.

Required security boundary: a second composition origin, `iframe sandbox="allow-scripts"` without `allow-same-origin`, no preload/Node access, a versioned postMessage protocol checked against the parent window and an explicit parent origin, and bounded request/response timeouts. Sandboxed opaque iframe messages require source-window checks; never weaken the outer sandbox to make DOM access easier.

Before implementing a host, verify the current runtime/player API and coordinate build entries plus composition-server URLs with backend-dev. Both hosts must use the same declared editable-props contract as the exporter. No host should report ready, time, hits or snapshots from a placeholder runtime.
