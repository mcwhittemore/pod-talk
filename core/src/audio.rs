//! Decode + resample to 16 kHz mono, and a tiny RMS VAD.

use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub const TARGET_RATE: u32 = 16_000;
/// Loudest-frame RMS below which `trim_silence` treats the whole clip as silence.
pub const MIN_SPEECH_RMS: f32 = 0.01;

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
    // Resample packet by packet so only the 16 kHz output is ever held in memory
    // (a 2 h episode at 44.1 kHz would otherwise need >1 GB before resampling).
    let mut rs = StreamResampler::new(src_rate, TARGET_RATE);
    let mut out: Vec<f32> = Vec::with_capacity(
        track.codec_params.n_frames.map(|n| (n as f64 * TARGET_RATE as f64 / src_rate as f64) as usize + 16).unwrap_or(0),
    );
    let mut packet_buf: Vec<f32> = Vec::new();
    let mut got_any = false;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(_)) => break,
            Err(symphonia::core::errors::Error::ResetRequired) => break,
            Err(e) => {
                if !got_any {
                    return Err(format!("packet: {e}"));
                }
                break;
            }
        };
        if packet.track_id() != track.id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(buf) => {
                packet_buf.clear();
                push_mono(&buf, &mut packet_buf);
                got_any = true;
                rs.push(&packet_buf, &mut out);
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(_) => break,
        }
    }
    rs.finish(&mut out);
    Ok(out)
}

/// Linear-interpolation resampler that accepts input in arbitrary pieces and
/// carries the last sample across calls so piece boundaries are seamless.
pub struct StreamResampler {
    ratio: f64,
    /// Position of the next output sample, in input samples, relative to index 0 of the next piece.
    pos: f64,
    prev: Option<f32>,
}

impl StreamResampler {
    pub fn new(from: u32, to: u32) -> Self {
        StreamResampler { ratio: from as f64 / to as f64, pos: 0.0, prev: None }
    }

    pub fn push(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if input.is_empty() {
            return;
        }
        if self.ratio == 1.0 {
            out.extend_from_slice(input);
            return;
        }
        let n = input.len();
        let sample = |i: i64| -> f32 {
            if i < 0 { self.prev.unwrap_or(input[0]) } else { input[i as usize] }
        };
        // Emit while both interpolation neighbours are available.
        while self.pos.floor() as i64 + 1 < n as i64 {
            let idx = self.pos.floor() as i64;
            let frac = (self.pos - idx as f64) as f32;
            let a = sample(idx);
            let b = sample(idx + 1);
            out.push(a + (b - a) * frac);
            self.pos += self.ratio;
        }
        self.prev = Some(input[n - 1]);
        self.pos -= n as f64;
    }

    /// Flush the trailing samples that only became complete at end of stream.
    pub fn finish(&mut self, out: &mut Vec<f32>) {
        if let Some(p) = self.prev {
            while self.pos < 0.0 {
                out.push(p);
                self.pos += self.ratio;
            }
        }
        self.prev = None;
    }
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
    let mut rs = StreamResampler::new(from, to);
    let mut out = Vec::with_capacity((input.len() as f64 * to as f64 / from as f64) as usize + 1);
    rs.push(input, &mut out);
    rs.finish(&mut out);
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
    // Absolute floor: a clip whose loudest 20 ms frame is below this is room noise, not speech.
    if peak < MIN_SPEECH_RMS {
        return Vec::new();
    }
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
    fn stream_matches_batch_across_pieces() {
        let v: Vec<f32> = (0..1000).map(|i| ((i as f32) * 0.3).sin()).collect();
        let whole = resample_linear(&v, 44100, 16000);
        let mut rs = StreamResampler::new(44100, 16000);
        let mut out = Vec::new();
        for piece in v.chunks(37) {
            rs.push(piece, &mut out);
        }
        rs.finish(&mut out);
        assert_eq!(whole.len(), out.len());
        for (a, b) in whole.iter().zip(&out) {
            assert!((a - b).abs() < 1e-5);
        }
    }
    #[test]
    fn quiet_clip_is_silence() {
        let v: Vec<f32> = (0..16000).map(|i| ((i as f32) * 0.1).sin() * 0.003).collect();
        assert!(trim_silence(&v, 16000, 300).is_empty());
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
