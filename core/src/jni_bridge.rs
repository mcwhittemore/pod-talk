//! JNI surface used by `dev.podtalk.core.PodTalkCore` (Kotlin). JSON in/out
//! for structured data, primitive arrays for PCM.

use jni::objects::{JClass, JFloatArray, JString};
use jni::sys::{jfloatArray, jint, jlong, jstring};
use jni::JNIEnv;

fn jstr(env: &mut JNIEnv, s: &JString) -> String {
    env.get_string(s).map(|x| x.into()).unwrap_or_default()
}
fn out(env: &mut JNIEnv, s: String) -> jstring {
    env.new_string(s).map(|s| s.into_raw()).unwrap_or(std::ptr::null_mut())
}
fn floats_in(env: &mut JNIEnv, arr: &JFloatArray) -> Vec<f32> {
    let len = env.get_array_length(arr).unwrap_or(0) as usize;
    let mut v = vec![0f32; len];
    let _ = env.get_float_array_region(arr, 0, &mut v);
    v
}
fn floats_out(env: &mut JNIEnv, v: &[f32]) -> jfloatArray {
    match env.new_float_array(v.len() as i32) {
        Ok(arr) => {
            let _ = env.set_float_array_region(&arr, 0, v);
            arr.into_raw()
        }
        Err(_) => std::ptr::null_mut(),
    }
}
fn err_json(e: String) -> String {
    serde_json::json!({ "error": e }).to_string()
}

#[no_mangle]
pub extern "system" fn Java_dev_podtalk_core_PodTalkCore_nativeInit(_env: JNIEnv, _c: JClass) {
    android_logger::init_once(android_logger::Config::default().with_max_level(log::LevelFilter::Info).with_tag("podtalk-core"));
    log::info!("podtalk-core {} initialised", crate::VERSION);
}

#[no_mangle]
pub extern "system" fn Java_dev_podtalk_core_PodTalkCore_nativeVersion(mut env: JNIEnv, _c: JClass) -> jstring {
    out(&mut env, format!("podtalk-core {} (whisper.cpp)", crate::VERSION))
}

#[no_mangle]
pub extern "system" fn Java_dev_podtalk_core_PodTalkCore_nativeDecode(mut env: JNIEnv, _c: JClass, path: JString) -> jfloatArray {
    let p = jstr(&mut env, &path);
    match crate::audio::decode_to_16k(&p) {
        Ok(v) => floats_out(&mut env, &v),
        Err(e) => {
            log::error!("decode failed: {e}");
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_dev_podtalk_core_PodTalkCore_nativeTrimSilence(mut env: JNIEnv, _c: JClass, pcm: JFloatArray, rate: jint, max_gap_ms: jint) -> jfloatArray {
    let v = floats_in(&mut env, &pcm);
    let t = crate::audio::trim_silence(&v, rate as u32, max_gap_ms as u32);
    floats_out(&mut env, &t)
}

#[no_mangle]
pub extern "system" fn Java_dev_podtalk_core_PodTalkCore_nativeTranscribePcm(
    mut env: JNIEnv,
    _c: JClass,
    model: JString,
    pcm: JFloatArray,
    threads: jint,
    strip_fillers: jni::sys::jboolean,
    language: JString,
) -> jstring {
    let m = jstr(&mut env, &model);
    let lang = jstr(&mut env, &language);
    let v = floats_in(&mut env, &pcm);
    let r = crate::transcribe::transcribe(&m, &v, threads, strip_fillers != 0, 0, if lang.is_empty() { "en" } else { &lang });
    let s = match r {
        Ok(t) => serde_json::to_string(&t).unwrap_or_default(),
        Err(e) => err_json(e),
    };
    out(&mut env, s)
}

/// Transcribes a whole file. Progress is reported through a static callback
/// into Kotlin: `PodTalkCore.onProgress(doneMs, totalMs)`.
#[no_mangle]
pub extern "system" fn Java_dev_podtalk_core_PodTalkCore_nativeTranscribeFile(
    mut env: JNIEnv,
    class: JClass,
    model: JString,
    audio: JString,
    threads: jint,
    language: JString,
) -> jstring {
    let m = jstr(&mut env, &model);
    let a = jstr(&mut env, &audio);
    let lang = jstr(&mut env, &language);
    let lang = if lang.is_empty() { "en".to_string() } else { lang };
    let r = crate::transcribe::transcribe_file(&m, &a, threads, &lang, |done, total| {
        let _ = env.call_static_method(&class, "onProgress", "(JJ)V", &[(done as jlong).into(), (total as jlong).into()]);
        // A Java exception left pending here would abort the VM on our next JNI call.
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
    });
    let s = match r {
        Ok(t) => serde_json::to_string(&t).unwrap_or_default(),
        Err(e) => err_json(e),
    };
    out(&mut env, s)
}

#[no_mangle]
pub extern "system" fn Java_dev_podtalk_core_PodTalkCore_nativeAnswer(mut env: JNIEnv, _c: JClass, question: JString, segments_json: JString, position_ms: jlong) -> jstring {
    let q = jstr(&mut env, &question);
    let sj = jstr(&mut env, &segments_json);
    let segs: Vec<crate::Segment> = serde_json::from_str(&sj).unwrap_or_default();
    let a = crate::answer::answer(&q, &segs, position_ms as i64);
    out(&mut env, serde_json::to_string(&a).unwrap_or_default())
}

#[no_mangle]
pub extern "system" fn Java_dev_podtalk_core_PodTalkCore_nativeExcerpt(mut env: JNIEnv, _c: JClass, segments_json: JString, position_ms: jlong, window_ms: jlong) -> jstring {
    let sj = jstr(&mut env, &segments_json);
    let segs: Vec<crate::Segment> = serde_json::from_str(&sj).unwrap_or_default();
    let (text, s0, s1) = crate::answer::excerpt(&segs, position_ms as i64, window_ms as i64);
    out(&mut env, serde_json::json!({ "text": text, "start_ms": s0, "end_ms": s1 }).to_string())
}

#[no_mangle]
pub extern "system" fn Java_dev_podtalk_core_PodTalkCore_nativeStripFillers(mut env: JNIEnv, _c: JClass, text: JString) -> jstring {
    let t = jstr(&mut env, &text);
    out(&mut env, crate::fillers::strip_text(&t))
}
