//! whisper.cpp transcription (stand-in for desert-ant Voz on Android).

use crate::fillers::{self, Word};
use crate::{Segment, Transcript, CTX_CACHE};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

fn ensure_ctx(model_path: &str) -> Result<(), String> {
    let mut guard = CTX_CACHE.lock().map_err(|_| "ctx lock poisoned")?;
    if let Some((p, _)) = guard.as_ref() {
        if p == model_path {
            return Ok(());
        }
    }
    let mut params = WhisperContextParameters::default();
    params.use_gpu(false);
    let ctx = WhisperContext::new_with_params(model_path, params).map_err(|e| format!("load model: {e:?}"))?;
    *guard = Some((model_path.to_string(), ctx));
    Ok(())
}

/// Transcribe 16 kHz mono PCM. `offset_ms` shifts timestamps (useful when
/// transcribing a chunk of a longer file). `strip_fillers` removes uh/um and
/// reports the spans removed.
pub fn transcribe(
    model_path: &str,
    pcm: &[f32],
    threads: i32,
    strip_fillers: bool,
    offset_ms: i64,
    language: &str,
) -> Result<Transcript, String> {
    let t0 = std::time::Instant::now();
    if pcm.len() < 1600 {
        return Ok(Transcript { engine: engine_name(model_path), duration_ms: 0, segments: vec![], fillers_removed: vec![], processing_ms: 0 });
    }
    ensure_ctx(model_path)?;
    let guard = CTX_CACHE.lock().map_err(|_| "ctx lock poisoned")?;
    let (_, ctx) = guard.as_ref().ok_or("no ctx")?;
    let mut state = ctx.create_state().map_err(|e| format!("state: {e:?}"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(threads.max(1));
    params.set_language(Some(language));
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_token_timestamps(true);
    params.set_max_len(48);
    params.set_split_on_word(true);
    params.set_suppress_blank(true);
    params.set_no_context(true);
    // No temperature fallback: on-device we want bounded latency, not re-decodes.
    params.set_temperature_inc(0.0);
    params.set_entropy_thold(10.0);
    state.full(params, pcm).map_err(|e| format!("full: {e:?}"))?;

    let mut segments = Vec::new();
    let mut fillers_removed = Vec::new();
    for seg in state.as_iter() {
        let s_start = seg.start_timestamp() * 10 + offset_ms;
        let s_end = seg.end_timestamp() * 10 + offset_ms;
        // Rebuild words from tokens so we have timestamps per word.
        let mut words: Vec<Word> = Vec::new();
        for ti in 0..seg.n_tokens() {
            let Some(tok) = seg.get_token(ti) else { continue };
            let text = match tok.to_str_lossy() {
                Ok(t) => t.to_string(),
                Err(_) => continue,
            };
            if text.starts_with("[_") || text.starts_with("<|") {
                continue; // special tokens
            }
            let d = tok.token_data();
            let (t0, t1) = (d.t0 * 10 + offset_ms, d.t1 * 10 + offset_ms);
            if text.starts_with(' ') || words.is_empty() {
                words.push(Word { text: text.clone(), start_ms: t0, end_ms: t1 });
            } else if let Some(w) = words.last_mut() {
                w.text.push_str(&text);
                w.end_ms = t1;
            }
        }
        let (kept, removed) = if strip_fillers { fillers::strip(&words) } else { (words, vec![]) };
        fillers_removed.extend(removed);
        let text: String = kept.iter().map(|w| w.text.as_str()).collect::<String>();
        let text = text.trim().to_string();
        if text.is_empty() {
            continue;
        }
        segments.push(Segment { start_ms: s_start, end_ms: s_end, text });
    }
    Ok(Transcript {
        engine: engine_name(model_path),
        duration_ms: (pcm.len() as i64 * 1000) / 16_000 + offset_ms,
        segments,
        fillers_removed,
        processing_ms: t0.elapsed().as_millis(),
    })
}

fn engine_name(model_path: &str) -> String {
    let name = std::path::Path::new(model_path).file_stem().and_then(|s| s.to_str()).unwrap_or("whisper");
    format!("whisper.cpp/{name}")
}

/// Transcribe a whole audio file by decoding it and running whisper in
/// 5-minute chunks (keeps memory flat on the phone). `progress` is called with
/// (done_ms, total_ms).
pub fn transcribe_file(
    model_path: &str,
    audio_path: &str,
    threads: i32,
    language: &str,
    mut progress: impl FnMut(i64, i64),
) -> Result<Transcript, String> {
    let pcm = crate::audio::decode_to_16k(audio_path)?;
    let total_ms = pcm.len() as i64 * 1000 / 16_000;
    let chunk = 16_000 * 300;
    let mut all = Transcript { engine: engine_name(model_path), duration_ms: total_ms, segments: vec![], fillers_removed: vec![], processing_ms: 0 };
    let t0 = std::time::Instant::now();
    let mut off = 0usize;
    while off < pcm.len() {
        let end = (off + chunk).min(pcm.len());
        let offset_ms = off as i64 * 1000 / 16_000;
        let t = transcribe(model_path, &pcm[off..end], threads, false, offset_ms, language)?;
        all.segments.extend(t.segments);
        off = end;
        progress(off as i64 * 1000 / 16_000, total_ms);
    }
    all.processing_ms = t0.elapsed().as_millis();
    Ok(all)
}
