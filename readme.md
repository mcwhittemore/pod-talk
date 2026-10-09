# Pod Talk

A podcast player you can talk to. An Android app (Pixel 8, Android 15) downloads episodes from a listen queue managed by a small web app, transcribes them on-device, and lets you interrupt playback at any moment to ask a question or leave a comment by voice. The conversation is kept with the exact part of the episode it was about and synced to the server, which fans events out over webhooks.

Original brief: [progress/00-brief.md](progress/00-brief.md). Build log with screenshots and a GIF: [progress/02-build-log.md](progress/02-build-log.md). API contract: [progress/01-plan-and-api-contract.md](progress/01-plan-and-api-contract.md).

![demo](progress/demo-full-flow.gif)

## Layout

- `server/` — Next.js 15 on Vercel + Neon Postgres. RSS feeds, uploads (Vercel Blob), listen queue, transcripts, conversations, webhooks, and `/api/answer` (Claude when `ANTHROPIC_API_KEY` is set). Production: https://pod-talk-silk.vercel.app
- `core/` — Rust crate `podtalk-core`: audio decode/resample, silence trimming, whisper.cpp transcription with timestamps, filler-word removal, BM25 extractive answers. Built for Android with `core/build-android.sh`; a Mac CLI (`cargo run --release --bin podtalk`) for testing.
- `android/` — Kotlin / Jetpack Compose / Media3 app. Uses the Rust core over JNI and Desert Ant **Clear** for speech enhancement.

## Desert Ant on Android

Desert Ant's Kotlin SDK has Clear (and Ear, Emo, Gist, Moderator, Redact, Shapes, Tongue) for Android, but **not Voz or Uhm**. So:

| Brief said | On Android |
|---|---|
| `desert-ant:clear` to clean up the question audio | **Clear**, as-is (`ai.desertant:clear:3.6.0`) |
| `desert-ant:voz` to transcribe episodes and questions | **whisper.cpp** via `whisper-rs` inside the Rust core (offline, segment + token timestamps) |
| `desert-ant:uhm` to remove filler words | **Rust filler stripper** over whisper's token timestamps; removed spans are reported with timings |
| quick generation for the reply | server `/api/answer` → Claude Haiku 4.5 when `ANTHROPIC_API_KEY` is set; otherwise an on-device BM25 extractive answer from the transcript near the playback position |

## Run it

Server (local):

```bash
cd server && npm install
# .env.local: DATABASE_URL=postgres://... POD_TALK_TOKEN=yourtoken
npm run db:migrate   # optional: schema is also applied automatically on first request
npm run dev          # http://localhost:3000, log in with the token
npm run smoke        # exercises the whole API against the dev server
```

Deploy: `cd server && vercel deploy --prod` (project `pod-talk`, env vars `DATABASE_URL`, `POD_TALK_TOKEN`, optional `ANTHROPIC_API_KEY`, `BLOB_READ_WRITE_TOKEN`).

Rust core:

```bash
cd core && cargo test
cargo run --release --bin podtalk -- transcribe ~/models/ggml-tiny.en.bin some.mp3
./build-android.sh     # needs rustup target aarch64-linux-android, cargo-ndk, cmake, ninja, Android NDK
```

## Build and load the app on your Pixel 8

One-time setup on the phone:

1. Settings → About phone → tap **Build number** seven times to enable Developer options.
2. Settings → System → Developer options → turn on **USB debugging**.
3. Plug the phone into the Mac with USB. Tap **Allow** on the "Allow USB debugging?" prompt (tick "Always allow from this computer").

One-time setup on the Mac (already done on this machine; for a fresh Mac see the end of this section):

```bash
source env.sh          # JDK 17 in ~/jdk, Android SDK/NDK in ~/Library/Android/sdk, adb on PATH
adb devices            # should list your phone as "device" (not "unauthorized")
```

Build the native core and the APK, then install:

```bash
source env.sh
(cd core && ./build-android.sh)                       # Rust → android/app/src/main/jniLibs/arm64-v8a/
cd android
./gradlew assembleRelease -Ppodtalk.server=https://pod-talk-silk.vercel.app
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell am start -n dev.podtalk/.MainActivity
```

The first Gradle build downloads Gradle and dependencies (a few minutes); later builds take about a minute. The release build is signed with the debug key, which is fine for sideloading.

First launch: the server URL is pre-filled with production. Paste the API token (`cat ~/.podtalk-token` on this Mac, the same value as `POD_TALK_TOKEN` on Vercel), pick `tiny.en` (fast) or `base.en` (better), tap Save. On the queue screen tap **Download tiny.en** once; the whisper model comes from Hugging Face over the phone's network (75 MB). Desert Ant Clear downloads its weights the first time you tap **Ask or comment**. Grant the microphone permission when asked.

To skip the model download, push it over USB (the app's dev shortcut copies it in):

```bash
adb push ~/models/ggml-tiny.en.bin /data/local/tmp/
adb shell run-as dev.podtalk sh -c 'mkdir -p files/models && cp /data/local/tmp/ggml-tiny.en.bin files/models/'
```

Watching logs while you try it:

```bash
adb logcat -s podtalk-core Companion Enhancer AppState
```

Fresh Mac setup (what `env.sh` expects):

```bash
mkdir -p ~/jdk && cd ~/jdk && curl -L "https://api.adoptium.net/v3/binary/latest/17/ga/mac/aarch64/jdk/hotspot/normal/eclipse" | tar xz
brew install --cask android-commandlinetools && brew install cmake ninja
export JAVA_HOME=$(ls -d ~/jdk/jdk-17*/Contents/Home) ANDROID_HOME=~/Library/Android/sdk
yes | sdkmanager --sdk_root=$ANDROID_HOME --licenses
sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;27.2.12479018"
rustup target add aarch64-linux-android && cargo install cargo-ndk
```

## How the interrupt works

Tap **Ask or comment** (or type). Playback pauses → `conversation.paused` webhook. The mic records until ~1.2 s of silence. Clear enhances the audio; the Rust core trims silence, transcribes with whisper and strips fillers. The question turn is posted with `audio_position_ms` and the transcript segment range it falls in (`question.created`). The answer comes from the server LLM or the on-device BM25 fallback, is posted (`response.created`), spoken with Android TTS, and playback resumes (`conversation.resumed`). Everything is visible on the web app's Conversations page with the referenced transcript segments highlighted.

## Webhook events

`queue.item.added`, `queue.item.updated`, `transcript.synced`, `conversation.started`, `conversation.paused`, `conversation.resumed`, `conversation.ended`, `question.created`, `response.created`, `webhook.test`. JSON body `{ id, event, created_at, data }`, headers `X-PodTalk-Event` and `X-PodTalk-Signature: sha256=<hmac of body with the webhook secret>`. Deliveries are logged and shown on the Webhooks page.
