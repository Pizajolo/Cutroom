# Built-in compositions

Reserved for the `text-layer`, `captions`, `title` and `lower-third` HyperFrames templates (T21). No rendered template is included in the renderer-foundation milestone.

Each template needs `index.html`, a matching `props.json` contract, stable `data-cut-id` values and deterministic seekable animation. Text/captions must render through the same template in the live timeline and export. Templates are not complete until they pass the backend contract checker and real runtime seek/render tests. Consult `docs/design/spec.md` and the editable-props project note before implementation.
