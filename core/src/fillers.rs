//! Filler-word removal (stand-in for desert-ant Uhm on Android).
//! Works on words with timestamps so we can report exactly which spans were cut.

use crate::FillerSpan;

#[derive(Debug, Clone)]
pub struct Word {
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

const FILLERS: &[&str] = &[
    "um", "umm", "uh", "uhh", "uhm", "hmm", "hm", "mm", "mmm", "erm", "er", "ah", "ahh", "eh", "huh",
];

fn norm(w: &str) -> String {
    w.trim()
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
}

pub fn is_filler(word: &str) -> bool {
    let n = norm(word);
    if n.is_empty() {
        return false;
    }
    FILLERS.contains(&n.as_str()) || (n.len() >= 2 && n.chars().all(|c| c == 'u' || c == 'h' || c == 'm'))
}

/// Remove fillers and immediate stutter repeats ("the the"). Returns cleaned words + removed spans.
pub fn strip(words: &[Word]) -> (Vec<Word>, Vec<FillerSpan>) {
    let mut kept: Vec<Word> = Vec::with_capacity(words.len());
    let mut removed = Vec::new();
    for w in words {
        let is_repeat = kept
            .last()
            .map(|p| norm(&p.text) == norm(&w.text) && norm(&w.text).len() <= 4 && !norm(&w.text).is_empty())
            .unwrap_or(false);
        if is_filler(&w.text) || is_repeat {
            removed.push(FillerSpan { start_ms: w.start_ms, end_ms: w.end_ms, word: w.text.trim().to_string() });
        } else {
            kept.push(w.clone());
        }
    }
    (kept, removed)
}

/// Plain-text variant for when we only have text (e.g. server-side transcripts).
pub fn strip_text(text: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for tok in text.split_whitespace() {
        if is_filler(tok) {
            continue;
        }
        out.push(tok);
    }
    let mut s = out.join(" ");
    // tidy leftover punctuation like " , " produced by removing "um,"
    s = s.replace(" ,", ",").replace(" .", ".").replace(",,", ",");
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips() {
        assert_eq!(strip_text("So um, what did uh he mean by, hmm, that?"), "So what did he mean by, that?");
    }
    #[test]
    fn repeats() {
        let w = |t: &str, s: i64| Word { text: t.into(), start_ms: s, end_ms: s + 100 };
        let (k, r) = strip(&[w("the", 0), w("the", 100), w("um", 200), w("end", 300)]);
        assert_eq!(k.len(), 2);
        assert_eq!(r.len(), 2);
    }
}
