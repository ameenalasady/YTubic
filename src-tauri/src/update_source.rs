//! Install-kind detection for update routing.
//!
//! The in-app updater (tauri-plugin-updater) can only replace files the
//! user owns: Windows NSIS installs, macOS .dmg bundles, Linux AppImages
//! and dev builds. A system install — AUR/pacman, a manually installed
//! .deb/.rpm — belongs to the package manager: downloading a GitHub
//! artifact over it would need root, diverge from the package database,
//! and be overwritten by the next manager run anyway. So the frontend
//! asks once, via `update_source`, whether to offer download + restart
//! ("inApp") or package-manager guidance ("system").
//!
//! Detection (Linux only; other OSes always report "inApp"):
//! - `APPIMAGE` set → AppImage, user-owned → "inApp".
//! - Executable outside the system prefixes (`/usr/bin`, `/usr/lib`,
//!   `/opt`, `/app`) → manual/portable install (`/usr/local`, `$HOME`,
//!   dev `target/`) → "inApp".
//! - Otherwise the binary is system-owned → "system", with the manager
//!   guessed for tailored guidance: `pacman -Qqo <exe>` proves AUR
//!   ownership on Arch; distro release files distinguish apt/dnf homes
//!   (whose .deb/.rpm came from the Releases page, so guidance points
//!   back there — no repo carries this package).

// Only the Linux detection below touches the filesystem or spawns
// package managers; elsewhere these would be dead code.
#[cfg(target_os = "linux")]
use std::path::Path;

#[derive(serde::Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSource {
    /// "inApp" | "system".
    pub kind: &'static str,
    /// Meaningful only when kind == "system":
    /// "aur" | "apt" | "dnf" | "unknown".
    pub manager: &'static str,
    /// AUR helper binary found in PATH ("paru" | "yay" | "pikaur"),
    /// "" otherwise. Only set when manager == "aur".
    pub helper: &'static str,
}

const IN_APP: UpdateSource = UpdateSource {
    kind: "inApp",
    manager: "unknown",
    helper: "",
};

/// True when the running binary lives where system packages install
/// (`/usr/local` deliberately excluded — user-owned manual installs
/// keep the in-app path).
#[cfg(target_os = "linux")]
fn exe_is_system_owned() -> bool {
    match std::env::current_exe() {
        Ok(exe) => {
            exe.starts_with("/usr/bin")
                || exe.starts_with("/usr/lib")
                || exe.starts_with("/opt")
                || exe.starts_with("/app")
        }
        Err(_) => false,
    }
}

/// Precise AUR proof: is this exact binary tracked by pacman?
/// `pacman -Qqo <path>` exits 0 with the owning package, non-zero
/// otherwise. Local db read, no root, milliseconds.
#[cfg(target_os = "linux")]
fn pacman_owns_exe() -> bool {
    let exe = match std::env::current_exe() {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(_) => return false,
    };
    std::process::Command::new("pacman")
        .arg("-Qqo")
        .arg(&exe)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// First AUR helper that actually runs, checked in preference order.
/// Only consulted for AUR installs, so a stray helper binary on a
/// deb/rpm system never surfaces in the UI.
#[cfg(target_os = "linux")]
fn aur_helper() -> &'static str {
    for h in ["paru", "yay", "pikaur"] {
        let runs = std::process::Command::new(h)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if runs {
            return h;
        }
    }
    ""
}

#[tauri::command]
pub fn update_source() -> UpdateSource {
    #[cfg(not(target_os = "linux"))]
    {
        return IN_APP;
    }

    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("APPIMAGE").is_some() {
            return IN_APP;
        }
        if !exe_is_system_owned() {
            return IN_APP;
        }
        if Path::new("/etc/arch-release").exists() && pacman_owns_exe() {
            return UpdateSource {
                kind: "system",
                manager: "aur",
                helper: aur_helper(),
            };
        }
        if Path::new("/etc/debian_version").exists() {
            return UpdateSource {
                kind: "system",
                manager: "apt",
                helper: "",
            };
        }
        if Path::new("/etc/fedora-release").exists()
            || Path::new("/etc/redhat-release").exists()
            || Path::new("/etc/SuSE-release").exists()
            || Path::new("/etc/opensuse-release").exists()
        {
            return UpdateSource {
                kind: "system",
                manager: "dnf",
                helper: "",
            };
        }
        UpdateSource {
            kind: "system",
            manager: "unknown",
            helper: "",
        }
    }
}
