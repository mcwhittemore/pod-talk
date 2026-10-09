//! BM25 extractive answer over transcript segments, biased toward the
//! current playback position. This is the offline fallback when the server
//! has no LLM key; it also always supplies the "which part of the audio was
//! this about" excerpt that gets synced with the conversation.

use crate::{stopwords, tokenize, Answer, Segment};
use std::collections::HashMap;

pub struct Window {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

/// Group consecutive segments into ~25 s windows for scoring.
pub fn windows(segments: &[Segment], target_ms: i64) -> Vec<Window> {
    let mut out: Vec<Window> = Vec::new();
    for s in segments {
        match out.last_mut() {
            Some(w) if s.end_ms - w.start_ms <= target_ms => {
                w.end_ms = s.end_ms;
                w.text.push(' ');
                w.text.push_str(s.text.trim());
            }
            _ => out.push(Window { start_ms: s.start_ms, end_ms: s.end_ms, text: s.text.trim().to_string() }),
        }
    }
    out
}

/// Text of the transcript around `position_ms` (± window_ms), used as LLM context.
pub fn excerpt(segments: &[Segment], position_ms: i64, window_ms: i64) -> (String, i64, i64) {
    let lo = position_ms - window_ms;
    let hi = position_ms + window_ms / 4; // mostly what was just heard
    let mut parts = Vec::new();
    let (mut s0, mut s1) = (i64::MAX, i64::MIN);
    for s in segments {
        if s.end_ms >= lo && s.start_ms <= hi {
            parts.push(s.text.trim().to_string());
            s0 = s0.min(s.start_ms);
            s1 = s1.max(s.end_ms);
        }
    }
    if parts.is_empty() {
        return (String::new(), position_ms, position_ms);
    }
    (parts.join(" "), s0, s1)
}

pub fn answer(question: &str, segments: &[Segment], position_ms: i64) -> Answer {
    let wins = windows(segments, 25_000);
    if wins.is_empty() {
        return Answer {
            text: "I don't have a transcript for this part yet, so I can't answer from the episode.".into(),
            segment_start_ms: position_ms,
            segment_end_ms: position_ms,
            excerpt: String::new(),
            score: 0.0,
            engine: "bm25-local".into(),
        };
    }
    let q: Vec<String> = tokenize(question).into_iter().filter(|w| !stopwords().contains_key(w.as_str())).collect();
    let docs: Vec<Vec<String>> = wins.iter().map(|w| tokenize(&w.text)).collect();
    let n = docs.len() as f32;
    let avgdl = docs.iter().map(|d| d.len()).sum::<usize>() as f32 / n.max(1.0);
    let mut df: HashMap<&str, f32> = HashMap::new();
    for d in &docs {
        let mut seen = std::collections::HashSet::new();
        for t in d {
            if seen.insert(t.as_str()) {
                *df.entry(t.as_str()).or_default() += 1.0;
            }
        }
    }
    let (k1, b) = (1.5f32, 0.75f32);
    let mut best = (0usize, f32::MIN);
    for (i, d) in docs.iter().enumerate() {
        let mut tf: HashMap<&str, f32> = HashMap::new();
        for t in d {
            *tf.entry(t.as_str()).or_default() += 1.0;
        }
        let mut score = 0f32;
        for term in &q {
            let f = *tf.get(term.as_str()).unwrap_or(&0.0);
            if f == 0.0 {
                continue;
            }
            let n_t = *df.get(term.as_str()).unwrap_or(&0.0);
            let idf = ((n - n_t + 0.5) / (n_t + 0.5) + 1.0).ln();
            score += idf * (f * (k1 + 1.0)) / (f + k1 * (1.0 - b + b * d.len() as f32 / avgdl));
        }
        // Recency bias: what the listener just heard is most likely what they're asking about.
        let dist = (wins[i].end_ms - position_ms).abs() as f32 / 60_000.0;
        let bias = if wins[i].start_ms <= position_ms + 5_000 { 1.0 / (1.0 + dist) } else { 0.3 / (1.0 + dist) };
        let total = score * (0.5 + bias) + bias * 0.25;
        if total > best.1 {
            best = (i, total);
        }
    }
    let w = &wins[best.0];
    let sentence = best_sentence(&w.text, &q);
    let text = if best.1 > 0.6 {
        format!("From around {}: {}", mmss(w.start_ms), sentence)
    } else {
        format!("I'm not certain, but the closest part of the episode (around {}) says: {}", mmss(w.start_ms), sentence)
    };
    Answer {
        text,
        segment_start_ms: w.start_ms,
        segment_end_ms: w.end_ms,
        excerpt: w.text.clone(),
        score: best.1,
        engine: "bm25-local".into(),
    }
}

fn best_sentence(text: &str, q: &[String]) -> String {
    let sentences: Vec<&str> = text
        .split_inclusive(|c| c == '.' || c == '?' || c == '!')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if sentences.is_empty() {
        return text.to_string();
    }
    let mut best = (0usize, -1i32);
    for (i, s) in sentences.iter().enumerate() {
        let toks = tokenize(s);
        let hits = q.iter().filter(|t| toks.contains(t)).count() as i32;
        if hits > best.1 {
            best = (i, hits);
        }
    }
    // Return the best sentence with one neighbour for context, capped in length.
    let lo = best.0.saturating_sub(1);
    let hi = (best.0 + 2).min(sentences.len());
    let mut s = sentences[lo..hi].join(" ");
    if s.len() > 420 {
        s.truncate(420);
        s.push('…');
    }
    s
}

pub fn mmss(ms: i64) -> String {
    let s = ms / 1000;
    format!("{}:{:02}", s / 60, s % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_relevant_window() {
        let segs = vec![
            Segment { start_ms: 0, end_ms: 5000, text: "Welcome to the show. Today we talk about ants.".into() },
            Segment { start_ms: 30000, end_ms: 35000, text: "Desert ants navigate by counting their steps, like a pedometer.".into() },
            Segment { start_ms: 60000, end_ms: 65000, text: "Thanks for listening, see you next week.".into() },
        ];
        let a = answer("how do the ants navigate", &segs, 36000);
        assert!(a.text.contains("pedometer"), "{}", a.text);
        assert_eq!(a.segment_start_ms, 30000);
    }
}
