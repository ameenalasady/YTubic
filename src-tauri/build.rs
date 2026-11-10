fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        build_gst_plugin();
    }
    tauri_build::build()
}

/// Compile the GStreamer sink plugin (see gst-plugin/ytubicsink.c) into
/// gen/gst-plugin, where the Linux bundles pick it up (tauri.linux.conf.json)
/// and debug builds load it from (src/linux_audio.rs).
fn build_gst_plugin() {
    use std::path::PathBuf;
    use std::process::Command;

    const SOURCE: &str = "gst-plugin/ytubicsink.c";
    println!("cargo:rerun-if-changed={SOURCE}");

    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = manifest.join("gen/gst-plugin");
    let out = out_dir.join("libgstytubicsink.so");

    let flags = match Command::new("pkg-config")
        .args(["--cflags", "--libs", "gstreamer-1.0"])
        .output()
    {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).into_owned(),
        _ => {
            println!(
                "cargo:warning=gstreamer-1.0 development files not found (pkg-config); \
                 skipping the GStreamer sink plugin. The equaliser may be silent on \
                 Bluetooth outputs, and bundling will fail."
            );
            return;
        }
    };

    std::fs::create_dir_all(&out_dir).expect("create gen/gst-plugin");
    let compiler = cc::Build::new().get_compiler();
    let status = compiler
        .to_command()
        .args(["-shared", "-fPIC", "-O2", "-Wall", "-o"])
        .arg(&out)
        .arg(manifest.join(SOURCE))
        .args(flags.split_whitespace())
        .status()
        .expect("run the C compiler");
    assert!(status.success(), "compiling {SOURCE} failed");

    println!(
        "cargo:rustc-env=YTUBIC_GST_PLUGIN_DIR={}",
        out_dir.display()
    );
}
