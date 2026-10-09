# Install script for directory: /Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml

# Set the install prefix
if(NOT DEFINED CMAKE_INSTALL_PREFIX)
  set(CMAKE_INSTALL_PREFIX "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out")
endif()
string(REGEX REPLACE "/$" "" CMAKE_INSTALL_PREFIX "${CMAKE_INSTALL_PREFIX}")

# Set the install configuration name.
if(NOT DEFINED CMAKE_INSTALL_CONFIG_NAME)
  if(BUILD_TYPE)
    string(REGEX REPLACE "^[^A-Za-z0-9_]+" ""
           CMAKE_INSTALL_CONFIG_NAME "${BUILD_TYPE}")
  else()
    set(CMAKE_INSTALL_CONFIG_NAME "Release")
  endif()
  message(STATUS "Install configuration: \"${CMAKE_INSTALL_CONFIG_NAME}\"")
endif()

# Set the component getting installed.
if(NOT CMAKE_INSTALL_COMPONENT)
  if(COMPONENT)
    message(STATUS "Install component: \"${COMPONENT}\"")
    set(CMAKE_INSTALL_COMPONENT "${COMPONENT}")
  else()
    set(CMAKE_INSTALL_COMPONENT)
  endif()
endif()

# Install shared libraries without execute permission?
if(NOT DEFINED CMAKE_INSTALL_SO_NO_EXE)
  set(CMAKE_INSTALL_SO_NO_EXE "0")
endif()

# Is this installation the result of a crosscompile?
if(NOT DEFINED CMAKE_CROSSCOMPILING)
  set(CMAKE_CROSSCOMPILING "TRUE")
endif()

# Set path to fallback-tool for dependency-resolution.
if(NOT DEFINED CMAKE_OBJDUMP)
  set(CMAKE_OBJDUMP "/Users/mcwhittemore/Library/Android/sdk/ndk/27.2.12479018/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-objdump")
endif()

if(NOT CMAKE_INSTALL_LOCAL_ONLY)
  # Include the install script for the subdirectory.
  include("/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/build/ggml/src/cmake_install.cmake")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Unspecified" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib" TYPE STATIC_LIBRARY FILES "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/build/ggml/src/libggml.a")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Unspecified" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/include" TYPE FILE FILES
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml-cpu.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml-alloc.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml-backend.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml-blas.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml-cann.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml-cpp.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml-cuda.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml-opt.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml-metal.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml-rpc.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml-sycl.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml-vulkan.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/ggml-webgpu.h"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/whisper.cpp/ggml/include/gguf.h"
    )
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Unspecified" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib" TYPE STATIC_LIBRARY FILES "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/build/ggml/src/libggml-base.a")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Unspecified" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/cmake/ggml" TYPE FILE FILES
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/build/ggml/ggml-config.cmake"
    "/Users/mcwhittemore/mcw/pod-talk/core/target/aarch64-linux-android/release/build/whisper-rs-sys-012ec0e7cf9aaa23/out/build/ggml/ggml-version.cmake"
    )
endif()

