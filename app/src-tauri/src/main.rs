// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod linux_a11y;
mod linux_render;
mod runner;
mod windows_install_migration;

#[cfg(any(target_os = "windows", test))]
const WINDOWS_APP_USER_MODEL_ID: &str = "app.solomd";

#[cfg(any(target_os = "windows", test))]
fn windows_app_user_model_id_wide() -> Vec<u16> {
    WINDOWS_APP_USER_MODEL_ID
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(target_os = "windows")]
fn set_windows_app_user_model_id() {
    let app_id = windows_app_user_model_id_wide();
    unsafe {
        let _ = windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(
            app_id.as_ptr(),
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn set_windows_app_user_model_id() {}

fn main() {
    // v4.11.7: the MSI in Program Files is now the only installed Windows
    // channel. If this user still has the retired per-user NSIS build, let its
    // own uninstaller remove only that legacy installation before any UI opens.
    windows_install_migration::migrate_legacy_nsis_install();

    // The NSIS uninstaller above cannot remove taskbar pins; a pin against
    // the retired %LOCALAPPDATA% install lives on as a dead, blank-icon
    // button. Sweep those on every launch (also heals machines that
    // migrated before this fix shipped).
    windows_install_migration::remove_stale_taskbar_pins();

    // Keep the running process on the same stable Windows identity as the MSI
    // shortcuts. Taskbar pins and icon caches use this identity across upgrades.
    set_windows_app_user_model_id();

    // Linux (#158): whether to pin WEBKIT_DISABLE_DMABUF_RENDERER is one
    // documented, unit-tested decision in linux_render.rs. Short version:
    // the user's own value of the variable always wins; we only set it on
    // webkit2gtk < 2.44, the runtimes whose DMABUF renderer can still abort
    // at launch on some Mesa stacks. Everywhere else DMABUF stays enabled so
    // scrolling keeps its hardware-accelerated, vsync'd path.
    #[cfg(target_os = "linux")]
    linux_render::apply_dmabuf_renderer_policy();

    // Linux (#253): a wedged accessibility bus makes GTK and WebKit each block
    // the UI thread for their full D-Bus timeout before the window can appear.
    // Ask the bus ourselves, with our own deadline, and switch accessibility
    // off for this process only if it doesn't answer.
    linux_a11y::guard_against_wedged_a11y_bus();

    let initial_file: Option<String> = std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-'))
        .filter(|p| {
            let pp = std::path::Path::new(p);
            pp.exists()
                || pp
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| {
                        matches!(
                            e.to_ascii_lowercase().as_str(),
                            "md" | "markdown" | "mdown" | "mkd" | "txt"
                        )
                    })
                    .unwrap_or(false)
        });

    // Explicit multi-thread tokio runtime kept alive for the whole process
    // lifetime. Tauri 2 brings tokio transitively but doesn't always
    // enter a multi-thread runtime at plugin-setup time on Windows;
    // any plugin or sync code that does `tokio::spawn` during setup
    // would panic, and on Windows release builds (panic = abort) that
    // panic terminates the entire app at startup.
    //
    // First seen as the v1.1.2 Windows launch crash with the (now-gone)
    // tauri-plugin-aptabase. The defensive guard stays after the
    // telemetry migration to solomd.app/api/track because reqwest
    // streaming + autogit + RAG all rely on the same multi-thread
    // runtime being available.
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");
    let _guard = rt.enter();

    runner::run_with(initial_file);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_app_id_matches_tauri_bundle_identifier() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid Tauri config");

        assert_eq!(
            config["identifier"].as_str(),
            Some(WINDOWS_APP_USER_MODEL_ID)
        );

        let wide = windows_app_user_model_id_wide();
        assert_eq!(wide.last(), Some(&0));
        assert_eq!(
            wide[..wide.len() - 1],
            WINDOWS_APP_USER_MODEL_ID.encode_utf16().collect::<Vec<_>>()
        );
    }
}
