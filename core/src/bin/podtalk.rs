//! Tiny CLI for testing the core on the Mac: `podtalk transcribe model.bin file.mp3`
fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(|s| s.as_str()) {
        Some("transcribe") => {
            let t = podtalk_core::transcribe::transcribe_file(&args[2], &args[3], 4, "en", |d, t| eprintln!("{d}/{t} ms")).unwrap();
            println!("{}", serde_json::to_string_pretty(&t).unwrap());
        }
        Some("answer") => {
            let segs: Vec<podtalk_core::Segment> = serde_json::from_str(&std::fs::read_to_string(&args[3]).unwrap()).unwrap();
            let a = podtalk_core::answer::answer(&args[2], &segs, args.get(4).and_then(|s| s.parse().ok()).unwrap_or(0));
            println!("{}", serde_json::to_string_pretty(&a).unwrap());
        }
        _ => eprintln!("usage: podtalk transcribe <model> <audio> | answer <question> <segments.json> [position_ms]"),
    }
}
