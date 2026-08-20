# public/assets/

Real business media lands here. The builder agent references files as
`/assets/<file>` — nothing hotlinked, no Unsplash, no `via.placeholder.com`
(DESIGN.md §2).

The `placeholder-*.jpg` files are flat noise-textured colour fields, generated
with ffmpeg. They exist so the STARTER page exercises `KenBurnsImage`,
`MaskWipe` and `HorizontalRail` in a real build — they are deliberately abstract
and depict nothing.

**Delete every `placeholder-*` file when you build a real site.** They must never
ship, and they must never be presented as a photo of the business.

`<VideoHero>` needs an mp4/webm plus a poster still. There is no placeholder
video here on purpose: without real footage the component falls back to
`KenBurnsImage` on the poster, which is the correct behaviour for the majority
of businesses that have no usable clip.
