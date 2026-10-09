//! Decode + resample to 16 kHz mono, and a tiny RMS VAD.

use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub const TARGET_RATE: u32 = 16_000;

/// Decode any supported container/codec to 16 kHz mono f32 in [-1, 1].
pub fn decode_to_16k(path: &str) -> Result<Vec<f32>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open {path}: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("probe: {e}"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or("no audio track")?
        .clone();
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("decoder: {e}"))?;
    let src_rate = track.codec_params.sample_rate.ok_or("unknown sample rate")?;
    let mut mono: Vec<f32> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(_)) => break,
            Err(symphonia::core::errors::Error::ResetRequired) => break,
            Err(e) => {
                if mono.is_empty() {
                    return Err(format!("packet: {e}"));
                }
                break;
            }
        };
        if packet.track_id() != track.id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(buf) => push_mono(&buf, &mut mono),
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(_) => break,
        }
    }
    Ok(resample_linear(&mono, src_rate, TARGET_RATE))
}

fn push_mono(buf: &AudioBufferRef, out: &mut Vec<f32>) {
    macro_rules! mix {
        ($b:expr, $conv:expr) => {{
            let ch = $b.spec().channels.count();
            let frames = $b.frames();
            for i in 0..frames {
                let mut acc = 0f32;
                for c in 0..ch {
                    acc += $conv($b.chan(c)[i]);
                }
                out.push(acc / ch as f32);
            }
        }};
    }
    match buf {
        AudioBufferRef::F32(b) => mix!(b, |x: f32| x),
        AudioBufferRef::F64(b) => mix!(b, |x: f64| x as f32),
        AudioBufferRef::S16(b) => mix!(b, |x: i16| x as f32 / 32768.0),
        AudioBufferRef::S32(b) => mix!(b, |x: i32| x as f32 / 2147483648.0),
        AudioBufferRef::U8(b) => mix!(b, |x: u8| (x as f32 - 128.0) / 128.0),
        AudioBufferRef::S24(b) => mix!(b, |x: symphonia::core::sample::i24| x.inner() as f32 / 8388608.0),
        AudioBufferRef::U16(b) => mix!(b, |x: u16| (x as f32 - 32768.0) / 32768.0),
        AudioBufferRef::U24(b) => mix!(b, |x: symphonia::core::sample::u24| (x.inner() as f32 - 8388608.0) / 8388608.0),
        AudioBufferRef::U32(b) => mix!(b, |x: u32| (x as f64 / 2147483648.0 - 1.0) as f32),
        AudioBufferRef::S8(b) => mix!(b, |x: i8| x as f32 / 128.0),
    }
}

/// Linear-interpolation resampler. Good enough for speech → whisper.
pub fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let out_len = ((input.len() as f64) / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let idx = pos.floor() as usize;
        let frac = (pos - idx as f64) as f32;
        let a = input[idx.min(input.len() - 1)];
        let b = input[(idx + 1).min(input.len() - 1)];
        out.push(a + (b - a) * frac);
    }
    out
}

/// Trim leading/trailing silence and collapse internal silences longer than
/// `max_gap_ms` to `max_gap_ms`. RMS over 20 ms frames, threshold relative to
/// the loudest frame so it adapts to the mic gain.
pub fn trim_silence(pcm: &[f32], rate: u32, max_gap_ms: u32) -> Vec<f32> {
    let frame = (rate / 50) as usize; // 20 ms
    if pcm.len() < frame * 2 {
        return pcm.to_vec();
    }
    let rms: Vec<f32> = pcm
        .chunks(frame)
        .map(|c| (c.iter().map(|x| x * x).sum::<f32>() / c.len() as f32).sqrt())
        .collect();
    let peak = rms.iter().cloned().fold(0f32, f32::max);
    let thr = (peak * 0.08).max(0.004);
    let voiced: Vec<bool> = rms.iter().map(|&r| r > thr).collect();
    let first = match voiced.iter().position(|&v| v) {
        Some(i) => i.saturating_sub(5),
        None => return Vec::new(),
    };
    let last = voiced.iter().rposition(|&v| v).unwrap_or(voiced.len() - 1) + 5;
    let max_gap = (max_gap_ms as usize / 20).max(1);
    let mut out = Vec::with_capacity(pcm.len());
    let mut gap = 0usize;
    for (i, chunk) in pcm.chunks(frame).enumerate() {
        if i < first || i > last {
            continue;
        }
        if voiced[i] {
            gap = 0;
            out.extend_from_slice(chunk);
        } else {
            gap += 1;
            if gap <= max_gap {
                out.extend_from_slice(chunk);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resample_halves() {
        let v: Vec<f32> = (0..100).map(|i| i as f32).collect();
        let r = resample_linear(&v, 32000, 16000);
        assert_eq!(r.len(), 50);
        assert!((r[10] - 20.0).abs() < 1e-3);
    }
    #[test]
    fn trims_edges() {
        let mut v = vec![0f32; 16000];
        for i in 4000..8000 {
            v[i] = ((i as f32) * 0.05).sin() * 0.5;
        }
        let t = trim_silence(&v, 16000, 300);
        assert!(t.len() < 8000 && t.len() > 3500, "len {}", t.len());
    }
}
