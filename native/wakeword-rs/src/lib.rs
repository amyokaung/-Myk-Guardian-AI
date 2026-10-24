use jni::objects::{JClass, JShortArray, JString};
use jni::sys::{jfloat, jint, jlong};
use jni::JNIEnv;
use livekit_wakeword::WakeWordModel;
use std::path::PathBuf;
use std::sync::Mutex;

struct Detector {
    model: WakeWordModel,
}

#[no_mangle]
pub extern "system" fn Java_com_myk_guardianai_accessibility_NativeWakeWordBridge_nativeCreate(
    mut env: JNIEnv,
    _class: JClass,
    model_path: JString,
    sample_rate: jint,
) -> jlong {
    let path: String = match env.get_string(&model_path) {
        Ok(value) => value.into(),
        Err(_) => return 0,
    };
    let model_path = PathBuf::from(path);
    match WakeWordModel::new(&[model_path], sample_rate as u32) {
        Ok(model) => Box::into_raw(Box::new(Mutex::new(Detector { model }))) as jlong,
        Err(error) => {
            let _ = env.throw_new("java/lang/IllegalStateException", format!("Wake model load failed: {error}"));
            0
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_myk_guardianai_accessibility_NativeWakeWordBridge_nativePredict(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    audio: JShortArray,
) -> jfloat {
    if handle == 0 { return 0.0; }
    let length = match env.get_array_length(&audio) {
        Ok(value) => value as usize,
        Err(_) => return 0.0,
    };
    let mut samples = vec![0i16; length];
    if env.get_short_array_region(&audio, 0, &mut samples).is_err() { return 0.0; }
    let detector = unsafe { &*(handle as *const Mutex<Detector>) };
    let mut guard = match detector.lock() {
        Ok(value) => value,
        Err(_) => return 0.0,
    };
    match guard.model.predict(&samples) {
        Ok(scores) => scores.get("amara_ye_burmese").copied().unwrap_or(0.0),
        Err(_) => 0.0,
    }
}

#[no_mangle]
pub extern "system" fn Java_com_myk_guardianai_accessibility_NativeWakeWordBridge_nativeDestroy(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    if handle != 0 {
        unsafe { drop(Box::from_raw(handle as *mut Mutex<Detector>)); }
    }
}
