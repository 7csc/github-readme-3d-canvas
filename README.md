# github-3d-canvas

**English** | [日本語](README.ja.md)

A GitHub Action that renders three.js scenes in headless Chrome and turns them into looping animations (GIF / APNG) for your GitHub profile README.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="dist/contributions-dark.gif">
  <img src="dist/contributions-light.gif" width="640" alt="Contribution skyline">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="dist/text-dark.gif">
  <img src="dist/text-light.gif" width="640" alt="3D text">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="dist/orbits-dark.gif">
  <img src="dist/orbits-light.gif" width="560" alt="Planet orbits">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="dist/canvas-dark.gif">
  <img src="dist/canvas-light.gif" width="360" alt="3D object">
</picture>

## Presets

| Preset | What it shows | Output |
|---|---|---|
| `contributions` | Your contribution calendar as a 3D bar chart (skyline) | `contributions-*.gif` |
| `text` | Your name (or any text) as extruded 3D letters | `text-*.gif` |
| `orbits` | Planets orbiting a sun with Keplerian motion | `orbits-*.gif` |
| `object` | A spinning built-in shape or glTF model | `canvas-*.gif` |

By default, `contributions` and `text` use the name and data of the repository owner (`{user}`).

## Add it to your profile (GitHub Action)

No fork needed. Add a single workflow to your profile repository (`<username>/<username>`).

**1. Add a workflow** — `.github/workflows/3d-canvas.yml`

```yaml
name: 3D canvas

on:
  workflow_dispatch:        # run manually from the Actions tab
  schedule:
    - cron: '0 0 * * *'     # refresh daily (useful for contributions)
  push:
    branches: [main]
    paths:                  # re-render when configs, models, textures or fonts change
      - '**.json'
      - 'models/**'
      - 'textures/**'
      - 'fonts/**'

permissions:
  contents: write           # needed to commit the images

concurrency:                # if runs overlap, cancel the older one
  group: 3d-canvas
  cancel-in-progress: true

jobs:
  render:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: 7csc/github-3d-canvas@v1
        with:
          config: contributions text   # preset names or config file paths
```

**2. Run "3D canvas" from the Actions tab** — `dist/contributions-dark.gif` and friends get committed.

**3. Embed them in your profile README** — they switch automatically with the viewer's GitHub theme.

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="dist/contributions-dark.gif">
  <img src="dist/contributions-light.gif" width="640" alt="Contribution skyline">
</picture>
```

### Inputs

| Input | Default | Description |
|---|---|---|
| `config` | `orbits` | Preset names or config file paths, space-separated |
| `output` | `dist` | Directory the images are written to |
| `commit` | `true` | Whether to commit and push the rendered images |
| `commit-message` | `chore: render 3D canvas` | Commit message |
| `user` | repository owner | GitHub user that replaces `{user}` in configs |
| `token` | `${{ github.token }}` | Token used to fetch data for `contributions` |

The `changed` output is `true` when the images differ from the last commit.

- Only the `output` directory is committed. It is added even if `.gitignore` ignores it, and nothing else you have staged is included.
- If the branch moved while rendering, the commit is rebuilt on top of the latest branch and pushed.
- On checkouts that are not on a branch (`pull_request`, tags, …) the images are rendered but not committed, with a warning.
- A mistake in a config stops the run before rendering, with an error naming the file and the key.
- `contributions` can read public contributions with the default `github.token`.

### Customizing

Put a JSON file in your repository and pick a base with `"preset"`; you only need to write the keys you want to change. Output files are named after the JSON file (`my-text.json` → `dist/my-text-dark.gif`).

```json
{
  "preset": "text",
  "text": { "value": "Hello,\nWorld" },
  "material": { "color": "#f97316" }
}
```

```yaml
      - uses: 7csc/github-3d-canvas@v1
        with:
          config: my-text.json
```

- Objects are merged; arrays (such as `planets`) are replaced as a whole.
- Omitted keys get defaults, so a config without `preset` works with just the keys it needs.
- Setting a theme to `null` skips that image.
- `model`, `material.texture` and `text.font` can point at files in your repository (`models/logo.glb`, `textures/wood.jpg`, `fonts/NotoSansJP-Bold.otf`, …). Paths are case-sensitive.

### Transparent backgrounds (APNG)

With `"format": "apng"` the output is an animated PNG with full alpha. Set the background to `"transparent"` and a single image looks right on both dark and light themes.

```json
{
  "preset": "object",
  "format": "apng",
  "themes": { "light": null, "dark": { "background": "transparent" } }
}
```

```html
<img src="dist/my-object-dark.png" width="360" alt="3D object">
```

APNG looks close to full colour but tends to be larger than GIF, so tune `frames` and the size. GIF cannot store semi-transparency, so `"transparent"` is only available with APNG.

## Configuration

### Common

| Key | Default | Description |
|---|---|---|
| `preset` | — | Preset to start from; only the keys you set are overridden |
| `scene` | `object` | `object` / `orbits` / `contributions` |
| `name` | config file name | Prefix of the output file names |
| `format` | `gif` | `gif` or `apng` |
| `width` / `height` | per scene | Output size (px, 16–2000) |
| `frames` / `fps` | per scene / `30` | Frame count (1–1000) and playback speed (1–50). One loop lasts `frames / fps` seconds |
| `supersample` | `2` | Internal resolution multiplier (integer 1–4, for anti-aliasing) |
| `themes.<name>.background` | `dark` / `light` | Background colour (`#rgb` / `#rrggbb`, or `transparent` with APNG). One image per theme (`null` skips it) |

### `object` scene (presets `object` / `text`)

A single model animates while casting a shadow on the floor.

| Key | Default | Description |
|---|---|---|
| `model` | `torusKnot` | `torusKnot` / `sphere` / `box` / `icosahedron` / `text`, or a `.glb` / `.gltf` in your repository (Draco / Meshopt / KTX2 compression supported) |
| `animation` | `spin` (`sway` for `text`) | `spin` (rotate and tilt) / `turntable` (horizontal rotation) / `sway` (rocks side to side; stays mostly front-facing, good for text) |
| `material.color` | `#8b5cf6` | Base colour |
| `material.texture` | `none` | `stripes` / `checker` / `none`, or an image path (png / jpg / webp / gif / svg) |
| `material.metalness` / `roughness` / `clearcoat` | `0.2` / `0.3` / `1` | PBR parameters (0–1) |
| `themes.<name>.shadowOpacity` | `0.4` | Floor shadow strength |

`material` applies to built-in models and text. glTF models keep the materials stored in the file.

Settings for `model: "text"`:

| Key | Default | Description |
|---|---|---|
| `text.value` | `{user}` | Text to show. Use `\n` for line breaks |
| `text.font` | `inter` | The bundled Inter (Latin), or a `.ttf` / `.otf` / `.woff` in your repository. For Japanese and other scripts, point at a font file that covers them |
| `text.weight` | `700` | Weight of `inter` (`400` / `700` / `900`) |
| `text.depth` | `0.3` | Letter thickness |
| `text.bevel` | `true` | Whether to round the edges |
| `text.lineHeight` | `1.2` | Line spacing |

### `contributions` scene (preset `contributions`)

Shows the past year of contributions as one bar per day: height by contribution count, colour by GitHub's four levels.

| Key | Default | Description |
|---|---|---|
| `contributions.user` | `{user}` | User to show |
| `contributions.animation` | `sway` | `sway` (rocks side to side) / `turntable` (one full turn) |
| `contributions.elevation` | `32` | Camera angle above the horizon (0–90°) |
| `contributions.heightScale` | `1` | Bar height multiplier |
| `contributions.label` | `true` | Whether to show the user name and total on the front of the base |
| `contributions.data` | — | Data to use instead of fetching from GitHub: `{ "weeks": [[Sun, Mon, …, Sat], …] }` (up to 60 weeks, `null` for missing days) |
| `themes.<name>.levels` | GitHub colours | Array of 5 colours (none, then levels 1–4). The default follows how dark the background is |
| `themes.<name>.base` / `labelColor` | from the background | Colours of the base and the label |

### `orbits` scene (preset `orbits`)

Planets travel on elliptical orbits around a sun. Motion follows Kepler's equation, so planets speed up near periapsis.

| Key | Default | Description |
|---|---|---|
| `orbits.elevation` | `24` | Camera angle above the orbital plane (0–90°). The camera distance adjusts so everything fits at any angle |
| `orbits.sunColor` / `sunRadius` | `#ffb347` / `0.75` | Sun colour and radius |
| `orbits.seed` | `7` | Random seed for textures and the star field |
| `orbits.planets` | 5 planets | Array of planets; see below |
| `themes.<name>.orbitColor` / `orbitOpacity` | `#ffffff` / `0.3` | Orbit line colour and opacity |
| `themes.<name>.stars` | `true` | Whether to show background stars |

Per-planet settings (only `distance` and `orbits` are **required**):

| Key | Default | Description |
|---|---|---|
| `distance` | — | Semi-major axis (a number greater than 0) |
| `orbits` | — | Orbits per loop (**integer**, so the loop is seamless; negative runs backwards) |
| `color` / `radius` | `#9ca3af` / `0.2` | Colour and radius |
| `texture` | `rocky` | `rocky` / `gas` / `ocean` / `plain` |
| `eccentricity` / `inclination` | `0` / `0` | Eccentricity (0–0.95) and orbital inclination (degrees) |
| `spin` / `tilt` | `3` / `10` | Rotations per loop (integer) and axial tilt (degrees) |
| `ring` / `ringColor` | `false` / planet colour | Whether to add a ring, and its colour |
| `moon` | none | `{ "radius", "distance", "orbits", "color" }` adds one moon (all but `color` required) |

```json
"planets": [
  { "color": "#3b82f6", "texture": "ocean", "radius": 0.22, "distance": 2.7, "orbits": 3,
    "moon": { "color": "#d1d5db", "radius": 0.06, "distance": 0.42, "orbits": 9 } },
  { "color": "#d6a35c", "texture": "gas", "radius": 0.42, "distance": 5.5, "orbits": 1, "ring": true, "tilt": 24 }
]
```

## Running locally

```sh
npm install
npm run render                                    # render every preset to out/
node src/render.js --help                         # list options
node src/render.js --user octocat text            # render with {user} set (default output: dist/)
GITHUB_TOKEN=$(gh auth token) node src/render.js --user octocat contributions
node src/render.js --workspace ../profile my.json # use configs and assets from another repository
npm test                                          # unit tests
```

Paths for config files and `model` / `texture` / `font` are relative to `--workspace` (the current directory by default).

The images in `dist/` are rendered by CI (Linux) and committed from there. Rendering differs slightly between operating systems, so please don't commit locally rendered images to `dist/` (`npm run render` writes to the git-ignored `out/`).

## Notes

- GIF is limited to 256 colours, so scenes with many gradients can show banding.
- For GIF, regions unchanged since the previous frame are written as transparent pixels to keep files small.
- If a file is too large, lower `frames` or `width` / `height` (a warning appears above 10 MB).
- Frame delays are in 1/100 s units. The rounding is spread across frames, so a loop lasts exactly `frames / fps` seconds.

## License

[MIT](LICENSE). The bundled Inter font is licensed under the SIL Open Font License 1.1 (`@fontsource/inter`).
