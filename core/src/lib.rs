//! podtalk-core: the native, "wicked fast" half of Pod Talk.
//!
//! - decode any podcast audio (mp3/aac/wav/ogg) to 16 kHz mono f32
//! - trim silence / simple RMS VAD for the listener's spoken question
//! - transcribe with whisper.cpp (replaces desert-ant Voz, which has no Android build)
//! - strip filler words using whisper token timestamps (replaces desert-ant Uhm)
//! - BM25 extractive answers over the transcript (offline fallback for reply generation)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub mod audio;
pub mod answer;
pub mod fillers;
pub mod transcribe;

#[cfg(target_os = "android")]
pub mod jni_bridge;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Segment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FillerSpan {
    pub start_ms: i64,
    pub end_ms: i64,
    pub word: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transcript {
    pub engine: String,
    pub duration_ms: i64,
    pub segments: Vec<Segment>,
    pub fillers_removed: Vec<FillerSpan>,
    pub processing_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Answer {
    pub text: String,
    pub segment_start_ms: i64,
    pub segment_end_ms: i64,
    pub excerpt: String,
    pub score: f32,
    pub engine: String,
}

/// Global whisper context cache so repeated calls don't reload the model. The
/// lock is only held while swapping the model; callers clone the `Arc` and run
/// inference on their own `WhisperState` outside the lock, so a question can
/// be transcribed while a long episode is being chunked through.
pub(crate) static CTX_CACHE: Mutex<Option<Arc<(String, whisper_rs::WhisperContext)>>> = Mutex::new(None);

/// Word frequency helper shared by answer + fillers.
pub(crate) fn tokenize(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|w| !w.is_empty())
        .map(|w| w.trim_matches('\'').to_string())
        .filter(|w| !w.is_empty())
        .collect()
}

pub(crate) fn stopwords() -> &'static HashMap<&'static str, ()> {
    use once_cell::sync::Lazy;
    static S: Lazy<HashMap<&'static str, ()>> = Lazy::new(|| {
        [
            "the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "that", "this", "what",
            "who", "why", "how", "when", "where", "did", "do", "does", "was", "were", "are", "be",
            "i", "you", "he", "she", "they", "we", "me", "my", "your", "about", "on", "for",
            "with", "so", "but", "just", "like", "can", "could", "would", "say", "said", "tell",
            "mean", "meant", "again", "there", "here", "at", "as", "by", "from", "into", "than",
            "then", "them", "their", "its", "if", "not", "no", "yes", "um", "uh", "hmm",
        ]
        .into_iter()
        .map(|w| (w, ()))
        .collect()
    });
    &S
}
