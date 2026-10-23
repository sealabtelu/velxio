# Arduino-only builds: board allow-list and image profiles

Velxio ships about thirty boards. If you only need some of them, for example
a classroom that only teaches the Arduino Uno, you can turn the rest off with
two independent switches:

| Switch | Kind | What it changes |
| --- | --- | --- |
| `VITE_ENABLED_BOARDS` | Frontend build-time env var | Which boards the UI offers |
| `VELXIO_PROFILE` | Docker build-arg | What the image downloads and installs |

They are separate so a manual (non-Docker) setup can use the first one alone.
In Docker, `VELXIO_PROFILE=arduino` sets `VITE_ENABLED_BOARDS=arduino` for you.

---

## Quick start: Arduino-only Docker image

```bash
git clone https://github.com/davidmonterocrespo24/velxio.git
cd velxio
docker build -f Dockerfile.standalone \
  --build-arg VELXIO_PROFILE=arduino \
  -t velxio:arduino .

docker run -d --name velxio -p 3080:80 \
  -v velxio-data:/app/data \
  -v velxio-arduino-libs:/root/.arduino15 \
  -v velxio-arduino-user-libs:/root/Arduino \
  velxio:arduino
```

With Docker Compose, set the build-arg in `docker-compose.yml`:

```yaml
services:
  velxio:
    build:
      context: .
      dockerfile: Dockerfile.standalone
      args:
        VELXIO_PROFILE: arduino
```

The `ccache` and `velxio-build` volumes only serve ESP-IDF compiles, so an
Arduino image does not need them.

---

## `VITE_ENABLED_BOARDS`: frontend board allow-list

A comma-separated list of board kinds and group names, read when Vite builds
the bundle. Tokens are trimmed and case-insensitive.

| Value | Boards offered |
| --- | --- |
| unset, empty or `all` | Every board (the default) |
| `arduino` | Arduino Uno, Nano, Mega 2560 |
| `avr` | Uno, Nano, Mega 2560, ATtiny85 |
| `arduino-uno` | Uno only |
| `arduino,esp32` | Uno, Nano, Mega 2560, ESP32 DevKit V1 |

Board kinds are the ids in `BoardKind` (`frontend/src/types/board.ts`), such as
`arduino-uno`, `raspberry-pi-pico`, `esp32-s3` and `attiny85`. Kinds registered by
the private overlay are accepted too. Groups are defined in `BOARD_GROUPS` in
`frontend/src/lib/enabledBoards.ts`.

### Where it applies

- **Component picker** (the canvas "Add" button): the Boards section lists only
  allowed boards, and the "available online at velxio.dev" board ads are hidden.
- **New Project dialog**: only cards for allowed boards appear. A section left
  with no cards (ESP32, STM32, Raspberry Pi, ...) is hidden.
- **Examples gallery**: examples that need a disallowed board are hidden, and so
  are the board filter tabs left with no examples. Board-less circuits (the
  Analog and Digital tabs) stay, because they need no board.

### What it does not do

- **It is not a security boundary.** A `.vlx` file, a Wokwi `.zip` import or a
  direct `/examples/<id>` link that uses another board still loads. Whether that
  board can then compile and run is up to the backend: an `arduino` image has
  no ESP32 toolchain or emulator, so those compiles fail with an error.
- **It does not change the starting board.** A fresh editor still opens with an
  Arduino Uno. If your list leaves out the Uno, users start from the New
  Project dialog instead.
- **It does not shrink the JavaScript bundle.** The code for the other boards
  still ships; it is just never offered.

### Manual (non-Docker) setup

Vite inlines `VITE_*` variables at build time, so set the variable when you
start the dev server or build:

```bash
cd frontend
VITE_ENABLED_BOARDS=arduino npm run dev
VITE_ENABLED_BOARDS=arduino npm run build
```

Or put it in `frontend/.env.local` (gitignored):

```
VITE_ENABLED_BOARDS=arduino
```

A manual backend only needs `arduino-cli` with the AVR core:

```bash
arduino-cli core update-index
arduino-cli core install arduino:avr
```

Skip the RP2040 board-manager URL, ESP-IDF and the QEMU libraries.

---

## `VELXIO_PROFILE`: Docker image profile

A build-arg for `Dockerfile.standalone`.

| | `full` (default) | `arduino` |
| --- | --- | --- |
| Boards that compile and run | Arduino AVR, ATtiny85, RP2040, ESP32 / S3 / C3 family | Arduino Uno, Nano, Mega 2560, ATtiny85 |
| `qemu-provider` stage (libqemu `.so` + ROMs, needs a license key or `prebuilt/qemu/`) | Built | **Skipped** |
| `espidf-builder` stage (ESP-IDF 5.5 + arduino-esp32 clone, multi-GB) | Built | **Skipped** |
| libqemu runtime libs, `cmake`, `ninja-build`, `libusb`, `ccache` | Installed | **Not installed** |
| Frontend `VITE_ENABLED_BOARDS` | `all` | `arduino` (unless you pass your own) |
| arduino-cli cores installed at first boot | `arduino:avr`, `rp2040:rp2040`, `ATTinyCore:avr` (+ the `esp32:esp32` fallback when ESP-IDF is missing) | `arduino:avr`, `ATTinyCore:avr` |
| Declared `VOLUME`s | data, `.arduino15`, `Arduino`, ccache, velxio-build | data, `.arduino15`, `Arduino` |

Both profiles keep the parts that work on any board: nginx, the FastAPI
backend, arduino-cli, the custom-chip compiler (WASI-SDK) and SDCC for the
retro Z80/8080 chips.

### How it works

`Dockerfile.standalone` declares `ARG VELXIO_PROFILE=full` before the first
`FROM`. The runtime is split into stages:

```
runtime-base      shared: nginx, arduino-cli, WASI-SDK, backend, frontend
├─ runtime-arduino  ENV VELXIO_PROFILE=arduino
└─ runtime-full     ENV VELXIO_PROFILE=full + libqemu deps + QEMU + ESP-IDF
final             FROM runtime-${VELXIO_PROFILE}
```

BuildKit only builds stages the final image depends on, so the `arduino`
profile never reaches `qemu-provider` or `espidf-builder`. The image keeps
`VELXIO_PROFILE` as an env var, and `docker/entrypoint.sh` reads it at boot to
decide which board-manager URLs to register and which cores to install.

### Mixing the two

To get an Arduino image whose UI also offers the ATtiny85, pass both:

```bash
docker build -f Dockerfile.standalone \
  --build-arg VELXIO_PROFILE=arduino \
  --build-arg VITE_ENABLED_BOARDS=avr \
  -t velxio:avr .
```

`VITE_ENABLED_BOARDS` always wins over the value derived from the profile.
Don't allow boards the profile cannot run (for example `esp32` on an
`arduino` image): they would show in the UI and then fail to compile.

### Gotchas

- **BuildKit is required.** It has been the default builder since Docker 23.
  The legacy builder (`DOCKER_BUILDKIT=0`) builds every stage, so it would still
  try `qemu-provider` and fail without a license key.
- **Typos fail the build.** Any value other than `full` or `arduino` makes the
  last `FROM runtime-<value>` refer to a stage that does not exist. Docker then
  tries to pull an image with that name and fails.
- **Reusing an old `.arduino15` volume.** The entrypoint only registers
  board-manager URLs when `arduino-cli.yaml` does not exist yet. A volume
  created by a `full` image keeps its RP2040/ESP32 URLs, which is harmless,
  but its cores stay installed until you remove the volume.

---

## Files

| File | Role |
| --- | --- |
| `frontend/src/lib/enabledBoards.ts` | Parses `VITE_ENABLED_BOARDS`; `isBoardEnabled()`, `isBoardAllowListActive()`, `BOARD_GROUPS` |
| `frontend/src/components/ComponentPickerModal.tsx` | Filters the Boards section and the board ads |
| `frontend/src/components/editor/NewProjectDialog.tsx` | Filters the starter cards (`buildStarterSections`) |
| `frontend/src/components/examples/ExamplesGallery.tsx` | Filters the examples and board tabs |
| `frontend/src/__tests__/enabled-boards.test.ts` | Parser unit tests |
| `Dockerfile.standalone` | `VELXIO_PROFILE` / `VITE_ENABLED_BOARDS` build-args, `runtime-*` stages |
| `docker/entrypoint.sh` | Profile-aware core installation |
