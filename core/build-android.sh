#!/usr/bin/env bash
# Cross-compiles podtalk-core for Android arm64 into ../android/app/src/main/jniLibs.
# Requires: rustup target aarch64-linux-android, cargo-ndk, cmake, ninja, Android NDK.
set -euo pipefail
cd "$(dirname "$0")"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
NDK="${ANDROID_NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -1)}"
export ANDROID_HOME ANDROID_NDK_HOME="$NDK" ANDROID_NDK="$NDK"
# whisper-rs-sys drives whisper.cpp through the `cmake` crate; every CMAKE_* env var is passed as -D.
# We use CMake's built-in Android support instead of the NDK toolchain file, which defaults to armeabi-v7a.
export CMAKE_GENERATOR=Ninja
export CMAKE_MAKE_PROGRAM="$(command -v ninja)"
export CMAKE_SYSTEM_NAME=Android CMAKE_SYSTEM_VERSION=26 CMAKE_ANDROID_NDK="$NDK" CMAKE_ANDROID_ARCH_ABI=arm64-v8a
OUT=../android/app/src/main/jniLibs
# whisper-rs-sys links ggml-blas whenever the *host* is macOS (build-script cfg! bug); give it an empty archive.
AR="$NDK/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ar"
[ -x "$AR" ] || AR="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar"
mkdir -p target/android-stubs && [ -f target/android-stubs/libggml-blas.a ] || "$AR" rcs target/android-stubs/libggml-blas.a
export RUSTFLAGS="-L native=$(pwd)/target/android-stubs"
cargo ndk -t arm64-v8a --platform 26 -o "$OUT" build --release --lib
ls -la "$OUT"/arm64-v8a/
